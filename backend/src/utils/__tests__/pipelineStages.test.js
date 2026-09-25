import {
  ASSIGNABLE_STAGES,
  NORMAL_FLOW_STAGES,
  getMappedStage,
  isVolunteerStageOpen,
  recordStageTimestamps,
} from '../pipelineStages.js';

// Every displayStatus that exists in the database today, with the stage the
// tracker draws it at. If the client's flowDefinitions change, this is the file
// that should fail.
const REAL_STATUSES = {
  'Submitted':             'Submitted',
  'Initial Review':        'Initial Review',
  'Approved for Curation': 'Approved for Curation',
  'Approved for Portal':   'Approved for Curation',
  'Curation in Progress':  'Curation in Progress',
  'Clarification Needed':  'Curation in Progress',
  'Changes Requested':     'Curation in Progress',
  'Final Review':          'Final Review',
  'Import in Progress':    'Preparing for Release',
  'Preparing for Release': 'Preparing for Release',
  'Released':              'Released',
  'In Portal':             'Released',
  'Missing Data':          'Rejected',
  'Not Curatable':         'Rejected',
  'Rejected':              'Rejected',
};

describe('getMappedStage', () => {
  it.each(Object.entries(REAL_STATUSES))('maps displayStatus %s -> %s', (input, expected) => {
    expect(getMappedStage({ displayStatus: input })).toBe(expected);
  });

  describe('isVolunteerStageOpen', () => {
    it.each(['Submitted', 'Initial Review', 'Approved for Curation'])(
      'keeps volunteering open at %s',
      displayStatus => {
        expect(isVolunteerStageOpen({ displayStatus })).toBe(true);
      },
    );

    it.each([
      'Curation in Progress',
      'Clarification Needed',
      'Final Review',
      'Preparing for Release',
      'Released',
      'Rejected',
    ])('closes volunteering at %s', displayStatus => {
      expect(isVolunteerStageOpen({ displayStatus })).toBe(false);
    });
  });

  it('falls back to the stored status code when no label has been assigned', () => {
    // 84 submissions carry status=pending with displayStatus null.
    expect(getMappedStage({ status: 'pending', displayStatus: null })).toBe('Submitted');
    expect(getMappedStage({ status: 'in-progress' })).toBe('Curation in Progress');
    expect(getMappedStage({ status: 'rejected' })).toBe('Rejected');
    expect(getMappedStage({ status: 'in-portal' })).toBe('Released');
  });

  it('prefers the assigned label over the stored code', () => {
    // A curator who assigned a label has said something more specific.
    expect(getMappedStage({ status: 'in-review', displayStatus: 'Import in Progress' }))
      .toBe('Preparing for Release');
  });

  it("resolves the submitter-response label in both spellings", () => {
    expect(getMappedStage({ displayStatus: "Awaiting Submitter's Response" })).toBe('Curation in Progress');
    expect(getMappedStage({ displayStatus: 'Awaiting Submitters Response' })).toBe('Curation in Progress');
  });

  it('leaves an unknown status unmapped rather than inventing a stage', () => {
    // Better an unanchored note than one filed under a stage that never existed.
    expect(getMappedStage({ status: 'some-future-code' })).toBe('some-future-code');
    expect(getMappedStage({})).toBeNull();
    expect(getMappedStage(null)).toBeNull();
  });
});

describe('recordStageTimestamps', () => {
  it('stamps every stage up to and including the current one on first update', () => {
    const submission = { displayStatus: 'Submitted' };
    const timestamps = recordStageTimestamps(submission, '2024-01-01T00:00:00.000Z');
    expect(timestamps).toEqual({ Submitted: '2024-01-01T00:00:00.000Z' });
  });

  it('gives every stage skipped by a jump the same timestamp', () => {
    const submission = {
      displayStatus: 'Curation in Progress',
      stageTimestamps: { Submitted: '2024-01-01T00:00:00.000Z' },
    };
    const timestamps = recordStageTimestamps(submission, '2024-02-01T00:00:00.000Z');
    expect(timestamps).toEqual({
      Submitted: '2024-01-01T00:00:00.000Z',
      'Initial Review': '2024-02-01T00:00:00.000Z',
      'Approved for Curation': '2024-02-01T00:00:00.000Z',
      'Curation in Progress': '2024-02-01T00:00:00.000Z',
    });
  });

  it('leaves already-dated stages untouched on a later update', () => {
    const submission = {
      displayStatus: 'Final Review',
      stageTimestamps: {
        Submitted: '2024-01-01T00:00:00.000Z',
        'Initial Review': '2024-01-05T00:00:00.000Z',
        'Approved for Curation': '2024-01-05T00:00:00.000Z',
        'Curation in Progress': '2024-01-05T00:00:00.000Z',
      },
    };
    const timestamps = recordStageTimestamps(submission, '2024-03-01T00:00:00.000Z');
    expect(timestamps).toEqual({
      Submitted: '2024-01-01T00:00:00.000Z',
      'Initial Review': '2024-01-05T00:00:00.000Z',
      'Approved for Curation': '2024-01-05T00:00:00.000Z',
      'Curation in Progress': '2024-01-05T00:00:00.000Z',
      'Final Review': '2024-03-01T00:00:00.000Z',
    });
  });

  it('routes a rejection through the short rejected flow', () => {
    const submission = {
      displayStatus: 'Rejected',
      stageTimestamps: { Submitted: '2024-01-01T00:00:00.000Z' },
    };
    const timestamps = recordStageTimestamps(submission, '2024-01-10T00:00:00.000Z');
    expect(timestamps).toEqual({
      Submitted: '2024-01-01T00:00:00.000Z',
      'Initial Review': '2024-01-10T00:00:00.000Z',
      Rejected: '2024-01-10T00:00:00.000Z',
    });
  });
});

describe('one label per stage', () => {
  it('offers exactly the seven stages plus the single rejection label', () => {
    expect(ASSIGNABLE_STAGES).toEqual([...NORMAL_FLOW_STAGES, 'Rejected']);
  });

  it('maps every assignable label to itself', () => {
    for (const label of ASSIGNABLE_STAGES) {
      expect(getMappedStage({ displayStatus: label })).toBe(label);
    }
  });

  it('labels a bare status code with a main stage, never a sub-label', () => {
    for (const status of ['pending', 'received', 'in-progress', 'in-review',
      'missing-data', 'not-curatable', 'approved', 'rejected']) {
      expect(ASSIGNABLE_STAGES).toContain(getMappedStage({ status }));
    }
    expect(getMappedStage({ status: 'received' })).toBe('Initial Review');
    expect(getMappedStage({ status: 'in-review' })).toBe('Final Review');
    expect(getMappedStage({ status: 'missing-data' })).toBe('Rejected');
  });
});
