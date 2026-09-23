import { getMappedStage, isVolunteerStageOpen } from '../pipelineStages.js';

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
  'Missing Data':          'Not Curatable',
  'Not Curatable':         'Not Curatable',
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
      'Not Curatable',
    ])('closes volunteering at %s', displayStatus => {
      expect(isVolunteerStageOpen({ displayStatus })).toBe(false);
    });
  });

  it('falls back to the stored status code when no label has been assigned', () => {
    // 84 submissions carry status=pending with displayStatus null.
    expect(getMappedStage({ status: 'pending', displayStatus: null })).toBe('Submitted');
    expect(getMappedStage({ status: 'in-progress' })).toBe('Curation in Progress');
    expect(getMappedStage({ status: 'rejected' })).toBe('Not Curatable');
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
