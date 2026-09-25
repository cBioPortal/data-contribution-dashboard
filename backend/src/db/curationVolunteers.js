import { v4 as uuidv4 } from 'uuid';
import { pool, query } from './index.js';

const toVolunteer = (row) => ({
  id: row.id,
  submissionId: row.submission_id,
  userId: row.user_id,
  name: row.name,
  email: row.email,
  designation: row.designation,
  currentWork: row.current_work,
  status: row.status,
  consentedAt: row.consented_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  reviewRequestedAt: row.review_requested_at,
  reviewFeedback: row.review_feedback,
  reviewFeedbackAt: row.review_feedback_at,
  withdrawnAt: row.withdrawn_at,
});

export async function listCurationVolunteers(submissionId, { includeWithdrawn = false } = {}) {
  const { rows } = await query(
    `SELECT *
       FROM curation_volunteers
      WHERE submission_id = $1
        ${includeWithdrawn ? '' : "AND status IN ('pending', 'accepted', 'completed')"}
      ORDER BY created_at ASC`,
    [submissionId],
  );
  return rows.map(toVolunteer);
}

export async function getCurationVolunteer(submissionId, userId) {
  const { rows } = await query(
    `SELECT *
       FROM curation_volunteers
      WHERE submission_id = $1 AND user_id = $2`,
    [submissionId, userId],
  );
  return rows.length ? toVolunteer(rows[0]) : null;
}

export async function saveCurationVolunteer({
  submissionId,
  userId,
  name,
  email,
  designation,
  currentWork,
}) {
  const { rows } = await query(
    `INSERT INTO curation_volunteers
       (id, submission_id, user_id, name, email, designation, current_work)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (submission_id, user_id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       designation = EXCLUDED.designation,
       current_work = EXCLUDED.current_work,
       status = 'pending',
       consented_at = now(),
       updated_at = now(),
       review_requested_at = NULL,
       review_feedback = NULL,
       review_feedback_at = NULL,
       review_feedback_by = NULL,
       withdrawn_at = NULL
     RETURNING *`,
    [
      `cvol_${uuidv4()}`,
      submissionId,
      userId,
      name,
      email,
      designation,
      currentWork,
    ],
  );
  return toVolunteer(rows[0]);
}

export async function withdrawCurationVolunteer(submissionId, userId) {
  const { rows } = await query(
    `UPDATE curation_volunteers
        SET status = 'withdrawn', withdrawn_at = now(), updated_at = now()
      WHERE submission_id = $1
        AND user_id = $2
        AND status IN ('pending', 'accepted')
        AND review_requested_at IS NULL
      RETURNING *`,
    [submissionId, userId],
  );
  return rows.length ? toVolunteer(rows[0]) : null;
}

export async function reviewCurationVolunteer(submissionId, volunteerId, status, title) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT *
         FROM curation_volunteers
        WHERE id = $1 AND submission_id = $2
        FOR UPDATE`,
      [volunteerId, submissionId],
    );
    const current = currentResult.rows[0];
    if (
      !current ||
      current.status === 'withdrawn' ||
      current.status === 'completed' ||
      (status === 'completed' &&
        (current.status !== 'accepted' || !current.review_requested_at))
    ) {
      await client.query('ROLLBACK');
      return null;
    }
    if (current.status === status) {
      await client.query('COMMIT');
      return toVolunteer(current);
    }

    const { rows } = await client.query(
      `UPDATE curation_volunteers
          SET status = $3,
              updated_at = now(),
              review_requested_at = CASE
                WHEN $3 = 'completed' THEN review_requested_at
                ELSE NULL
              END,
              review_feedback = CASE WHEN $3 = 'accepted' THEN NULL ELSE review_feedback END,
              review_feedback_at = CASE WHEN $3 = 'accepted' THEN NULL ELSE review_feedback_at END,
              review_feedback_by = CASE WHEN $3 = 'accepted' THEN NULL ELSE review_feedback_by END
        WHERE id = $1 AND submission_id = $2
        RETURNING *`,
      [volunteerId, submissionId, status],
    );
    const volunteer = rows[0];

    if (volunteer.user_id && ['accepted', 'declined', 'completed'].includes(status)) {
      const notification = {
        accepted: {
          type: 'curation_application_accepted',
          message: `Your application was accepted. You are now the Community Curator for "${title}".`,
        },
        declined: {
          type: 'curation_application_declined',
          message: current.status === 'accepted'
            ? `Your Community Curator assignment for "${title}" has ended.`
            : `Your application to curate "${title}" was not selected.`,
        },
        completed: {
          type: 'curation_completed',
          message: `Your curation of "${title}" was approved and credited as completed.`,
        },
      }[status];
      await client.query(
        `INSERT INTO user_notifications
           (id, user_id, submission_id, type, title, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `notification_${uuidv4()}`,
          volunteer.user_id,
          submissionId,
          notification.type,
          title,
          notification.message,
        ],
      );
    }

    await client.query('COMMIT');
    return toVolunteer(volunteer);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function requestCurationReview(submissionId, userId) {
  const { rows } = await query(
    `UPDATE curation_volunteers
        SET review_requested_at = now(),
            review_feedback = NULL,
            review_feedback_at = NULL,
            review_feedback_by = NULL
      WHERE submission_id = $1
        AND user_id = $2
        AND status = 'accepted'
        AND review_requested_at IS NULL
      RETURNING *`,
    [submissionId, userId],
  );
  return rows.length ? toVolunteer(rows[0]) : null;
}

export async function requestCurationChanges({
  submissionId,
  volunteerId,
  reviewerId,
  feedback,
  title,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE curation_volunteers
          SET review_requested_at = NULL,
              review_feedback = $4,
              review_feedback_at = now(),
              review_feedback_by = $3
        WHERE id = $1
          AND submission_id = $2
          AND status = 'accepted'
          AND review_requested_at IS NOT NULL
        RETURNING *`,
      [volunteerId, submissionId, reviewerId, feedback],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return null;
    }

    const volunteer = rows[0];
    if (volunteer.user_id) {
      await client.query(
        `INSERT INTO user_notifications
           (id, user_id, submission_id, type, title, message)
         VALUES ($1, $2, $3, 'curation_changes_requested', $4, $5)`,
        [
          `notification_${uuidv4()}`,
          volunteer.user_id,
          submissionId,
          title,
          `Changes were requested for your curation of "${title}": ${feedback}`,
        ],
      );
    }
    await client.query('COMMIT');
    return toVolunteer(volunteer);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function countCurationVolunteers(submissionIds, userId = null) {
  if (!submissionIds.length) return {};
  const { rows } = await query(
    `SELECT submission_id,
            count(*) FILTER (WHERE status IN ('pending', 'accepted', 'completed'))::int AS volunteer_count,
            bool_or(status IN ('accepted', 'completed')) AS has_accepted,
            bool_or(status <> 'withdrawn' AND user_id = $2) AS has_volunteered,
            max(status) FILTER (WHERE user_id = $2) AS my_volunteer_status
       FROM curation_volunteers
      WHERE submission_id = ANY($1)
      GROUP BY submission_id`,
    [submissionIds, userId],
  );
  return Object.fromEntries(rows.map(row => [
    row.submission_id,
    {
      volunteerCount: row.volunteer_count,
      curationInterestAccepted: row.has_accepted === true,
      hasVolunteered: row.has_volunteered === true,
      myVolunteerStatus: row.my_volunteer_status,
    },
  ]));
}

export async function listCompletedCurationsForUser(userId) {
  const { rows } = await query(
    `SELECT cv.submission_id,
            COALESCE(
              NULLIF(s.doc->>'paperTitle', ''),
              NULLIF(s.doc->>'studyName', ''),
              'Untitled study'
            ) AS title,
            cv.updated_at AS completed_at
       FROM curation_volunteers cv
       JOIN submissions s ON s.id = cv.submission_id
      WHERE cv.user_id = $1
        AND cv.status = 'completed'
      ORDER BY cv.updated_at DESC`,
    [userId],
  );
  return rows.map(row => ({
    submissionId: row.submission_id,
    title: row.title,
    completedAt: row.completed_at,
  }));
}

export async function listActiveCurationsForUser(userId) {
  const { rows } = await query(
    `SELECT cv.submission_id,
            COALESCE(
              NULLIF(s.doc->>'paperTitle', ''),
              NULLIF(s.doc->>'studyName', ''),
              'Untitled study'
            ) AS title,
            cv.updated_at AS assigned_at,
            cv.review_requested_at,
            cv.review_feedback,
            cv.review_feedback_at
       FROM curation_volunteers cv
       JOIN submissions s ON s.id = cv.submission_id
      WHERE cv.user_id = $1
        AND cv.status = 'accepted'
      ORDER BY cv.updated_at DESC`,
    [userId],
  );
  return rows.map(row => ({
    submissionId: row.submission_id,
    title: row.title,
    assignedAt: row.assigned_at,
    reviewRequestedAt: row.review_requested_at,
    reviewFeedback: row.review_feedback,
    reviewFeedbackAt: row.review_feedback_at,
  }));
}

export async function listUserNotifications(userId) {
  const [itemsResult, countResult] = await Promise.all([
    query(
      `SELECT id, submission_id, type, title, message, read_at, created_at
         FROM user_notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [userId],
    ),
    query(
      `SELECT count(*)::int AS unread_count
         FROM user_notifications
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    ),
  ]);
  return {
    unreadCount: countResult.rows[0]?.unread_count ?? 0,
    items: itemsResult.rows.map(row => ({
      id: row.id,
      submissionId: row.submission_id,
      type: row.type,
      title: row.title,
      message: row.message,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
  };
}

export async function markUserNotificationRead(notificationId, userId) {
  const { rows } = await query(
    `UPDATE user_notifications
        SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [notificationId, userId],
  );
  return rows.length > 0;
}

export async function getCurationTeamWorkspace(userId) {
  const [assignmentsResult, applicationsResult, reviewsResult] = await Promise.all([
    query(
      `SELECT id AS submission_id,
              COALESCE(
                NULLIF(doc->>'paperTitle', ''),
                NULLIF(doc->>'studyName', ''),
                'Untitled study'
              ) AS title,
              COALESCE(NULLIF(doc->>'displayStatus', ''), status, 'Submitted') AS status,
              updated_at,
              count(*) OVER()::int AS total_count
         FROM submissions
        WHERE doc->>'leadCuratorId' = $1
        ORDER BY updated_at DESC
        LIMIT 20`,
      [userId],
    ),
    query(
      `SELECT cv.id AS volunteer_id,
              cv.submission_id,
              cv.name,
              COALESCE(
                NULLIF(s.doc->>'paperTitle', ''),
                NULLIF(s.doc->>'studyName', ''),
                'Untitled study'
              ) AS title,
              cv.created_at,
              count(*) OVER()::int AS total_count
         FROM curation_volunteers cv
         JOIN submissions s ON s.id = cv.submission_id
        WHERE cv.status = 'pending'
        ORDER BY cv.created_at ASC
        LIMIT 20`,
    ),
    query(
      `SELECT cv.id AS volunteer_id,
              cv.submission_id,
              cv.name,
              COALESCE(
                NULLIF(s.doc->>'paperTitle', ''),
                NULLIF(s.doc->>'studyName', ''),
                'Untitled study'
              ) AS title,
              cv.review_requested_at,
              count(*) OVER()::int AS total_count
         FROM curation_volunteers cv
         JOIN submissions s ON s.id = cv.submission_id
        WHERE cv.status = 'accepted'
          AND cv.review_requested_at IS NOT NULL
        ORDER BY cv.review_requested_at ASC
        LIMIT 20`,
    ),
  ]);

  return {
    leadAssignmentCount: assignmentsResult.rows[0]?.total_count ?? 0,
    leadAssignments: assignmentsResult.rows.map(row => ({
      submissionId: row.submission_id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
    })),
    pendingApplicationCount: applicationsResult.rows[0]?.total_count ?? 0,
    pendingApplications: applicationsResult.rows.map(row => ({
      volunteerId: row.volunteer_id,
      submissionId: row.submission_id,
      name: row.name,
      title: row.title,
      createdAt: row.created_at,
    })),
    awaitingReviewCount: reviewsResult.rows[0]?.total_count ?? 0,
    awaitingReview: reviewsResult.rows.map(row => ({
      volunteerId: row.volunteer_id,
      submissionId: row.submission_id,
      name: row.name,
      title: row.title,
      reviewRequestedAt: row.review_requested_at,
    })),
  };
}

export default {
  listCurationVolunteers,
  getCurationVolunteer,
  saveCurationVolunteer,
  withdrawCurationVolunteer,
  reviewCurationVolunteer,
  requestCurationReview,
  requestCurationChanges,
  countCurationVolunteers,
  listCompletedCurationsForUser,
  listActiveCurationsForUser,
  listUserNotifications,
  markUserNotificationRead,
  getCurationTeamWorkspace,
};
