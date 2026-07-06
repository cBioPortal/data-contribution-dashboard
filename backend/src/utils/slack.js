/**
 * Slack Notification Utility
 *
 * Sends formatted messages to a Slack channel via Incoming Webhook.
 * Silently skips if SLACK_WEBHOOK_URL is not configured.
 */

import fetch from 'node-fetch';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send a message to Slack.
 * @param {string} text - Slack markdown formatted message
 */
export async function sendSlackNotification(text) {
  if (!SLACK_WEBHOOK_URL) return;

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.error('Slack webhook error:', res.status, await res.text());
    }
  } catch (err) {
    // Log but never throw — Slack failures should not break the app
    console.error('Slack notification failed:', err.message);
  }
}

/**
 * Extract a short ID from a submission ID.
 * e.g. 'submission_27ab1bb7-0c53-47e4-92c9-88f1ac7e8179' → '27ab1bb7'
 *      'github_12345' → '12345'
 */
function shortId(id) {
  if (!id) return 'N/A';
  return id.replace(/^submission_/, '').replace(/^github_/, '').split('-')[0];
}

/**
 * Notify: new submission created via /submit page
 */
export function notifyNewSubmission(submission) {
  const isSuggestion = submission.submissionType === 'suggest-paper';
  const emoji = isSuggestion ? '📄' : '📊';
  const typeLabel = isSuggestion ? 'Study Suggestion' : 'Data Submission';
  const title = isSuggestion
    ? (submission.paperTitle || 'Untitled')
    : (submission.studyName || submission.paperTitle || 'Untitled');

  const lines = [
    `${emoji} *New ${typeLabel}*`,
    `*ID:* ${shortId(submission.id)}`,
    `*Title:* ${title}`,
    `*Submitter:* ${submission.submitterName || 'Unknown'} (${submission.submitterEmail || 'N/A'})`,
  ];

  if (submission.pmid) lines.push(`*PMID:* ${submission.pmid}`);
  if (submission.associatedPaper) lines.push(`*Paper:* ${submission.associatedPaper}`);
  if (submission.publicationType) lines.push(`*Publication:* ${submission.publicationType}`);
  if (submission.dataTypes && submission.dataTypes.length > 0) {
    lines.push(`*Data types:* ${submission.dataTypes.join(', ')}`);
  }
  if (submission.notes) {
    const truncated = submission.notes.length > 200
      ? submission.notes.substring(0, 200) + '...'
      : submission.notes;
    lines.push(`*Notes:* ${truncated}`);
  }

  return sendSlackNotification(lines.join('\n'));
}

/**
 * Notify: submitter added a note to their submission
 */
export function notifyNoteAdded(submissionId, noteText, submitterEmail, submissionTitle) {
  const truncated = noteText.length > 300
    ? noteText.substring(0, 300) + '...'
    : noteText;

  const lines = [
    `💬 *Note Added to Submission*`,
    `*ID:* ${shortId(submissionId)}`,
    `*Submission:* ${submissionTitle || submissionId}`,
    `*By:* ${submitterEmail}`,
    `*Note:* ${truncated}`,
  ];

  return sendSlackNotification(lines.join('\n'));
}
