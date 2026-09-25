import { API_URL } from '@/config';

export interface ProfileData {
  user: {
    name?: string;
    email: string;
    role: 'user' | 'super';
  };
  activeAssignments: {
    count: number;
    studies: Array<{
      submissionId: string;
      title: string;
      assignedAt: string;
      reviewRequestedAt: string | null;
      reviewFeedback: string | null;
      reviewFeedbackAt: string | null;
    }>;
  };
  contributions: {
    completedCurations: number;
    studies: Array<{
      submissionId: string;
      title: string;
      completedAt: string;
    }>;
  };
  notifications: {
    unreadCount: number;
    items: Array<{
      id: string;
      submissionId: string | null;
      type:
        | 'curation_application_accepted'
        | 'curation_application_declined'
        | 'curation_changes_requested'
        | 'curation_completed';
      title: string;
      message: string;
      readAt: string | null;
      createdAt: string;
    }>;
  };
  teamWorkspace: {
    leadAssignmentCount: number;
    leadAssignments: Array<{
      submissionId: string;
      title: string;
      status: string;
      updatedAt: string;
    }>;
    pendingApplicationCount: number;
    pendingApplications: Array<{
      volunteerId: string;
      submissionId: string;
      name: string;
      title: string;
      createdAt: string;
    }>;
    awaitingReviewCount: number;
    awaitingReview: Array<{
      volunteerId: string;
      submissionId: string;
      name: string;
      title: string;
      reviewRequestedAt: string;
    }>;
  } | null;
}

export const fetchProfile = async (token: string): Promise<ProfileData> => {
  const response = await fetch(`${API_URL}/api/auth/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to load profile');
  return (await response.json()).data;
};

export const markNotificationRead = async (notificationId: string, token: string) => {
  const response = await fetch(`${API_URL}/api/auth/notifications/${notificationId}/read`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to update notification');
};
