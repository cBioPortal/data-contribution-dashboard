import { logger } from './logger';

export interface IssueData {
  submissionId: string;
  issueNumber: string;
  url: string;
  status: string;
  title: string;
  author: string;
  createdAt: string;
}

export interface PullRequestData {
  submissionId: string;
  issueNumber: string;
  url: string;
  status: string;
  title: string;
  author: string;
  createdAt: string;
}

export const parseIssuesData = (data: string): IssueData[] => {
  if (!data || data.trim() === '') return [];
  try {
    const lines = data.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const values = line.split('\t');
      return {
        submissionId: values[0] || '',
        issueNumber: values[1] || '',
        url: values[2] || '',
        status: values[3] || '',
        title: values[4] || '',
        author: values[5] || '',
        createdAt: values[6] || '',
      };
    });
  } catch (error) {
    logger.error('Error parsing issues data:', error);
    return [];
  }
};

export const parsePullRequestsData = (data: string): PullRequestData[] => {
  if (!data || data.trim() === '') return [];
  try {
    const lines = data.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const values = line.split('\t');
      return {
        submissionId: values[0] || '',
        issueNumber: values[1] || '',
        url: values[2] || '',
        status: values[3] || '',
        title: values[4] || '',
        author: values[5] || '',
        createdAt: values[6] || '',
      };
    });
  } catch (error) {
    logger.error('Error parsing pull requests data:', error);
    return [];
  }
};
