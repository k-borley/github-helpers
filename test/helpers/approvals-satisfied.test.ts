/*
Copyright 2021 Expedia, Inc.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Mocktokit } from '../types';
import { approvalsSatisfied } from '../../src/helpers/approvals-satisfied';
import { octokit } from '../../src/octokit';
import { getRequiredCodeOwnersEntries } from '../../src/utils/get-core-member-logins';

const ownerMap: { [key: string]: Object } = {
  team1: { data: [{ login: 'user1' }] },
  team2: { data: [{ login: 'user2' }, { login: 'user3' }] },
  team3: { data: [{ login: 'user1' }] },
  team4: { data: [{ login: 'user4' }, { login: 'user5' }] },
  team5: { data: [{ login: 'user4' }, { login: 'user6' }, { login: 'user7' }] },
  team6: { data: [{ login: 'user8' }, { login: 'user9' }] }
};
jest.mock('@actions/core');
jest.mock('@actions/github', () => ({
  context: { repo: { repo: 'repo', owner: 'owner' }, issue: { number: 123 } },
  getOctokit: jest.fn(() => ({
    rest: {
      pulls: {
        listReviews: jest.fn()
      },
      teams: {
        listMembersInOrg: jest.fn(async input => ownerMap[input.team_slug])
      }
    }
  }))
}));
jest.mock('../../src/utils/get-core-member-logins');
const mockPagination = (result: unknown) => {
  (octokit.pulls.listReviews as unknown as Mocktokit).mockImplementation(async ({ page }) => {
    return page === 1 ? result : { data: [] };
  });
};

describe('approvalsSatisfied', () => {
  it('should return false when passing teams override and required approvals are not met', async () => {
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user3' }
        }
      ]
    });

    const result = await approvalsSatisfied({ teams: 'team1', pull_number: '12345' });
    expect(octokit.pulls.listReviews).toHaveBeenCalledWith({ pull_number: 12345, repo: 'repo', owner: 'owner', page: 1, per_page: 100 });
    expect(getRequiredCodeOwnersEntries).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('should return true when passing teams override and required approvals are met', async () => {
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user1' }
        }
      ]
    });
    const result = await approvalsSatisfied({ teams: 'team1', pull_number: '12345' });
    expect(octokit.pulls.listReviews).toHaveBeenCalledWith({ pull_number: 12345, repo: 'repo', owner: 'owner', page: 1, per_page: 100 });
    expect(getRequiredCodeOwnersEntries).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should return false when a core member has not approved', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([{ owners: ['@ExpediaGroup/team1'] }]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user3' }
        }
      ]
    });
    const result = await approvalsSatisfied({ pull_number: '12345' });
    expect(octokit.pulls.listReviews).toHaveBeenCalledWith({ pull_number: 12345, repo: 'repo', owner: 'owner', page: 1, per_page: 100 });
    expect(getRequiredCodeOwnersEntries).toHaveBeenCalledWith(12345);
    expect(result).toBe(false);
  });

  it('should return true when a core member has approved', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([{ owners: ['@ExpediaGroup/team1'] }]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user1' }
        },
        {
          state: 'CHANGES_REQUESTED',
          user: { login: 'user3' }
        }
      ]
    });
    const result = await approvalsSatisfied();
    expect(result).toBe(true);
  });

  it('should return false when not all core teams have approved', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([
      { owners: ['@ExpediaGroup/team1'] },
      { owners: ['@ExpediaGroup/team2'] },
      { owners: ['@ExpediaGroup/team3'] }
    ]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user1' }
        },
        {
          state: 'CHANGES_REQUESTED',
          user: { login: 'user3' }
        }
      ]
    });
    const result = await approvalsSatisfied();
    expect(result).toBe(false);
  });

  it('should return true when a member from each core team has approved', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([
      { owners: ['@ExpediaGroup/team1'] },
      { owners: ['@ExpediaGroup/team2'] },
      { owners: ['@ExpediaGroup/team3'] }
    ]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user1' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user2' }
        },
        {
          state: 'CHANGES_REQUESTED',
          user: { login: 'user3' }
        }
      ]
    });
    const result = await approvalsSatisfied();
    expect(result).toBe(true);
  });

  it('should return false when not enough members from core teams have approved', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([
      { owners: ['@ExpediaGroup/team2'] },
      { owners: ['@ExpediaGroup/team4'] }
    ]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user2' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user3' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user4' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(false);
  });

  it('should return true when enough members from core teams have approved', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([
      { owners: ['@ExpediaGroup/team2'] },
      { owners: ['@ExpediaGroup/team4'] }
    ]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user2' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user3' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user4' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user5' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(true);
  });

  it('should return false when not enough collective approvals from shared owners are met', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([{ owners: ['@ExpediaGroup/team4', '@ExpediaGroup/team5'] }]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user4' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(false);
  });

  it('should return false when not enough collective approvals from shared owners are met even if user is in both groups', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([{ owners: ['@ExpediaGroup/team4', '@ExpediaGroup/team5'] }]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user5' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(false);
  });

  it('should return true when enough collective approvals from shared owners are met', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([{ owners: ['@ExpediaGroup/team4', '@ExpediaGroup/team5'] }]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user4' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user6' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(true);
  });

  it('should return false when collective approvals are met but not standalone approvals', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([
      { owners: ['@ExpediaGroup/team4'] },
      { owners: ['@ExpediaGroup/team5', '@ExpediaGroup/team6'] }
    ]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user4' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user8' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(false);
  });

  it('should return true when both collective and standalone approvals are met', async () => {
    (getRequiredCodeOwnersEntries as jest.Mock).mockResolvedValue([
      { owners: ['@ExpediaGroup/team4'] },
      { owners: ['@ExpediaGroup/team5', '@ExpediaGroup/team6'] }
    ]);
    mockPagination({
      data: [
        {
          state: 'APPROVED',
          user: { login: 'user4' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user5' }
        },
        {
          state: 'APPROVED',
          user: { login: 'user8' }
        }
      ]
    });
    const result = await approvalsSatisfied({ number_of_reviewers: '2' });
    expect(result).toBe(true);
  });
});
