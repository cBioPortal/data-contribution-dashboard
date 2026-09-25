import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Award,
  Bell,
  CalendarDays,
  Check,
  ClipboardList,
  FileCheck2,
  Loader2,
  UserRound,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import SharedLayout from '@/components/SharedLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthToken } from '@/hooks/useAuthToken';
import { fetchProfile, markNotificationRead } from '@/services/profileApi';
import type { ProfileData } from '@/services/profileApi';

const trackerLink = (submissionId: string) =>
  `/track-status?submission=${encodeURIComponent(submissionId)}`;

const TeamWorkspace = ({
  workspace,
}: {
  workspace: NonNullable<ProfileData['teamWorkspace']>;
}) => (
  <div className="space-y-6">
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Users className="h-5 w-5 text-[#2C5EBE]" />
              Applications awaiting review
            </CardTitle>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              {workspace.pendingApplicationCount}
            </span>
          </div>
          <p className="text-sm text-slate-500">New expressions of interest from prospective Community Curators.</p>
        </CardHeader>
        <CardContent className="pt-0">
          {workspace.pendingApplications.length === 0 ? (
            <div className="py-10 text-center">
              <Users className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">No applications are waiting for review.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {workspace.pendingApplications.map(application => (
                <div key={application.volunteerId} className="py-4">
                  <p className="font-semibold text-slate-800">{application.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {application.name} applied {new Date(application.createdAt).toLocaleDateString()}
                  </p>
                  <Link
                    to={trackerLink(application.submissionId)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2C5EBE] hover:underline"
                  >
                    Review application <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <FileCheck2 className="h-5 w-5 text-[#2C5EBE]" />
              Curations awaiting approval
            </CardTitle>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              {workspace.awaitingReviewCount}
            </span>
          </div>
          <p className="text-sm text-slate-500">Community Curators who submitted completed work for team review.</p>
        </CardHeader>
        <CardContent className="pt-0">
          {workspace.awaitingReview.length === 0 ? (
            <div className="py-10 text-center">
              <FileCheck2 className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">No curations are waiting for approval.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {workspace.awaitingReview.map(review => (
                <div key={review.volunteerId} className="py-4">
                  <p className="font-semibold text-slate-800">{review.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {review.name} submitted on {new Date(review.reviewRequestedAt).toLocaleDateString()}
                  </p>
                  <Link
                    to={`/study/${review.submissionId}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2C5EBE] hover:underline"
                  >
                    Review curation <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <ClipboardList className="h-5 w-5 text-[#2C5EBE]" />
            My Lead Curator assignments
          </CardTitle>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
            {workspace.leadAssignmentCount}
          </span>
        </div>
        <p className="text-sm text-slate-500">Studies for which you are the assigned Lead Curator.</p>
      </CardHeader>
      <CardContent className="pt-0">
        {workspace.leadAssignments.length === 0 ? (
          <div className="py-10 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">You have no Lead Curator assignments.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {workspace.leadAssignments.map(study => (
              <div key={study.submissionId} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{study.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{study.status}</p>
                </div>
                <Link
                  to={trackerLink(study.submissionId)}
                  className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#2C5EBE] hover:text-[#1A3B6D]"
                >
                  Open submission <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  </div>
);

const Profile = () => {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['profile'],
    queryFn: () => fetchProfile(token as string),
    enabled: Boolean(token),
  });
  const readNotification = useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId, token as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });

  return (
    <SharedLayout>
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-[#1A3B6D] sm:text-4xl">My Profile</h1>
            <p className="mt-2 text-base text-slate-600">
              {data?.user.role === 'super'
                ? 'Review community curation work and manage your assigned studies.'
                : 'Manage your community curation work and view your contributions.'}
            </p>
          </div>

          {isLoading && (
            <div className="flex min-h-48 items-center justify-center text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading profile
            </div>
          )}

          {isError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="py-6 text-sm text-red-700">
                Your profile could not be loaded. Please refresh and try again.
              </CardContent>
            </Card>
          )}

          {data && (
            <div className="space-y-6">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-[#2C5EBE]">
                      <UserRound className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-semibold text-slate-800">
                        {data.user.name || data.user.email}
                      </h2>
                      {data.user.name && <p className="truncate text-sm text-slate-500">{data.user.email}</p>}
                    </div>
                  </div>
                  <p className="rounded-full bg-[#eef3fb] px-3 py-1.5 text-xs font-semibold text-[#1A3B6D]">
                    {data.user.role === 'super' ? 'Curation team' : 'Community member'}
                  </p>
                </CardContent>
              </Card>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ...(data.user.role === 'super' && data.teamWorkspace
                    ? [
                        { icon: ClipboardList, value: data.teamWorkspace.leadAssignmentCount, label: 'Lead assignments' },
                        { icon: Users, value: data.teamWorkspace.pendingApplicationCount, label: 'Applications to review' },
                        { icon: FileCheck2, value: data.teamWorkspace.awaitingReviewCount, label: 'Curations to approve' },
                      ]
                    : [
                        { icon: ClipboardList, value: data.activeAssignments.count, label: 'Active assignments' },
                        { icon: Award, value: data.contributions.completedCurations, label: 'Completed curations' },
                        { icon: Bell, value: data.notifications.unreadCount, label: 'Unread notifications' },
                      ]),
                ].map(item => (
                  <Card key={item.label} className="border-slate-200 bg-white shadow-sm">
                    <CardContent className="flex items-center gap-4 p-5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#2C5EBE]">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold leading-none text-[#2C5EBE]">{item.value}</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">{item.label}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {data.user.role === 'super' && data.teamWorkspace ? (
                <TeamWorkspace workspace={data.teamWorkspace} />
              ) : (
                <>
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-b border-slate-100">
                    <div className="flex items-center justify-between gap-4">
                      <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        <ClipboardList className="h-5 w-5 text-[#2C5EBE]" />
                        Active curation assignments
                      </CardTitle>
                      {data.activeAssignments.count > 0 && (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          {data.activeAssignments.count} active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">Studies assigned to you. When you've finished curating, submit your curated data for review.</p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {data.activeAssignments.studies.length === 0 ? (
                      <div className="py-10 text-center">
                        <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
                        <p className="mt-3 text-sm text-slate-500">You have no active curation assignments.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {data.activeAssignments.studies.map(study => (
                          <div key={study.submissionId} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800">{study.title}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {study.reviewRequestedAt
                                  ? `Awaiting review since ${new Date(study.reviewRequestedAt).toLocaleDateString()}`
                                  : study.reviewFeedback
                                    ? `Changes requested ${study.reviewFeedbackAt
                                        ? new Date(study.reviewFeedbackAt).toLocaleDateString()
                                        : ''}`
                                  : `Assigned ${new Date(study.assignedAt).toLocaleDateString()}`}
                              </p>
                              {study.reviewFeedback && !study.reviewRequestedAt && (
                                <p className="mt-2 text-xs text-amber-700">{study.reviewFeedback}</p>
                              )}
                            </div>
                            <Link
                              to={`/study/${study.submissionId}`}
                              className={study.reviewRequestedAt
                                ? 'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'
                                : 'inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#2C5EBE] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1A3B6D]'}
                            >
                              <FileCheck2 className="h-4 w-4" />
                              {study.reviewRequestedAt
                                ? 'View submitted data'
                                : study.reviewFeedback ? 'Resubmit curated data' : 'Submit curated data'}
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-b border-slate-100">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        <Bell className="h-5 w-5 text-[#2C5EBE]" />
                        Notifications
                      </CardTitle>
                      {data.notifications.unreadCount > 0 && (
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                          {data.notifications.unreadCount} unread
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {data.notifications.items.length === 0 ? (
                      <div className="py-10 text-center">
                        <Bell className="mx-auto h-8 w-8 text-slate-300" />
                        <p className="mt-3 text-sm text-slate-500">No notifications yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {data.notifications.items.map(notification => (
                          <div key={notification.id} className={`py-4 ${notification.readAt ? '' : 'border-l-2 border-blue-500 pl-3'}`}>
                            <p className="text-sm leading-5 text-slate-700">{notification.message}</p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs text-slate-400">
                                {new Date(notification.createdAt).toLocaleDateString()}
                              </span>
                              {!notification.readAt && (
                                <button
                                  type="button"
                                  onClick={() => readNotification.mutate(notification.id)}
                                  disabled={readNotification.isPending}
                                  className="flex items-center gap-1 text-xs font-medium text-[#2C5EBE] hover:text-[#1A3B6D] disabled:opacity-50"
                                >
                                  <Check className="h-3.5 w-3.5" /> Mark read
                                </button>
                              )}
                            </div>
                            {notification.submissionId && (
                              <Link
                                to={`/study/${notification.submissionId}`}
                                onClick={() => {
                                  if (!notification.readAt) readNotification.mutate(notification.id);
                                }}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2C5EBE] hover:underline"
                              >
                                View study <ArrowRight className="h-3 w-3" />
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                    <Award className="h-5 w-5 text-[#2C5EBE]" />
                    Community curation contributions
                  </CardTitle>
                  <p className="text-sm text-slate-500">Completed studies credited to your profile.</p>
                </CardHeader>
                <CardContent className="pt-0">
                  {data.contributions.studies.length === 0 ? (
                    <div className="py-10 text-center">
                      <Award className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-3 text-sm text-slate-500">Completed contributions will appear here.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {data.contributions.studies.map(study => (
                        <div key={study.submissionId} className="flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between">
                          <Link
                            to={`/study/${study.submissionId}`}
                            className="font-semibold text-slate-800 hover:text-[#2C5EBE] hover:underline"
                          >
                            {study.title}
                          </Link>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                            <CalendarDays className="h-3.5 w-3.5 text-[#2C5EBE]" />
                            Completed {new Date(study.completedAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </SharedLayout>
  );
};

export default Profile;
