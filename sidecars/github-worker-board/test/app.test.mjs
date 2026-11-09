import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardState,
  COLUMN_COLORS,
  escapeHtml,
  capitalize,
  filterItems,
  extractFilterOptions,
  groupItemsByStatus,
  createCardElement,
  renderBoard,
  POLL_INTERVAL_SECONDS,
  resetCountdown,
  tickCountdown,
  updateCountdownDisplay,
  toggleFilter,
  clearFilters,
  renderFilterChips,
} from '../app.js';

describe('boardState', () => {
  it('does not contain hideDone property', () => {
    assert.equal('hideDone' in boardState, false);
  });
});

describe('COLUMN_COLORS', () => {
  it('does not define colors for removed Done status', () => {
    assert.equal('Done' in COLUMN_COLORS, false);
    assert.equal('done' in COLUMN_COLORS, false);
  });
});

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and single quote', () => {
    const raw = `<script>alert("XSS" & 'test');</script>`;
    const escaped = escapeHtml(raw);
    assert.equal(escaped, '&lt;script&gt;alert(&quot;XSS&quot; &amp; &#39;test&#39;);&lt;/script&gt;');
  });

  it('handles non-string and nullish values defensively', () => {
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(123), '123');
    assert.equal(escapeHtml(true), 'true');
  });
});

describe('capitalize', () => {
  it('capitalizes the first character and lowercases the remainder', () => {
    assert.equal(capitalize('todo'), 'Todo');
    assert.equal(capitalize('IN PROGRESS'), 'In progress');
    assert.equal(capitalize('dOnE'), 'Done');
  });

  it('handles empty and nullish values safely', () => {
    assert.equal(capitalize(''), '');
    assert.equal(capitalize(null), '');
    assert.equal(capitalize(undefined), '');
  });
});

describe('filterItems', () => {
  const items = [
    {
      number: 1,
      title: 'Setup repository and workflows',
      author: 'alice',
      milestone: 'v1.0',
      labels: ['enhancement', 'setup'],
      action: 'NEEDS_PLAN',
      pullRequests: [],
    },
    {
      number: 2,
      title: 'Fix issue board refresh bug',
      author: 'bob',
      milestone: 'v1.0',
      labels: ['bug'],
      action: 'USER_REPLIED',
      pullRequests: [{ number: 10, title: 'Fix refresh loop' }],
    },
    {
      number: 3,
      title: 'Update documentation for sidecars',
      author: 'alice',
      milestone: 'v1.1',
      labels: ['docs'],
      action: 'WAITING_ON_USER',
      pullRequests: [{ number: 15, title: 'Docs update' }],
    },
  ];

  it('returns all items when query is empty or whitespace', () => {
    assert.equal(filterItems(items, '').length, 3);
    assert.equal(filterItems(items, '   ').length, 3);
    assert.equal(filterItems(items, null).length, 3);
  });

  it('filters by issue number', () => {
    const res = filterItems(items, '2');
    assert.equal(res.length, 1);
    assert.equal(res[0].number, 2);
  });

  it('filters by issue title substring case-insensitively', () => {
    const res = filterItems(items, 'BOARD');
    assert.equal(res.length, 1);
    assert.equal(res[0].number, 2);
  });

  it('filters by action status', () => {
    const res = filterItems(items, 'NEEDS_PLAN');
    assert.equal(res.length, 1);
    assert.equal(res[0].number, 1);
  });

  it('filters by linked PR number or title', () => {
    const byPrNum = filterItems(items, '15');
    assert.equal(byPrNum.length, 1);
    assert.equal(byPrNum[0].number, 3);

    const byPrTitle = filterItems(items, 'refresh loop');
    assert.equal(byPrTitle.length, 1);
    assert.equal(byPrTitle[0].number, 2);
  });

  it('handles missing or malformed item properties defensively', () => {
    const malformed = [{ number: null, title: null, action: null, pullRequests: null }];
    const res = filterItems(malformed, 'test');
    assert.equal(res.length, 0);
  });

  it('filters by active label chips', () => {
    const res = filterItems(items, '', { labels: ['bug'] });
    assert.equal(res.length, 1);
    assert.equal(res[0].number, 2);

    const resMultiple = filterItems(items, '', { labels: ['enhancement', 'setup'] });
    assert.equal(resMultiple.length, 1);
    assert.equal(resMultiple[0].number, 1);

    const resNone = filterItems(items, '', { labels: ['nonexistent'] });
    assert.equal(resNone.length, 0);
  });

  it('filters by active author chips', () => {
    const res = filterItems(items, '', { authors: ['alice'] });
    assert.equal(res.length, 2);
    assert.deepEqual(res.map((i) => i.number), [1, 3]);

    const resBob = filterItems(items, '', { authors: ['bob'] });
    assert.equal(resBob.length, 1);
    assert.equal(resBob[0].number, 2);
  });

  it('filters by active milestone chips', () => {
    const res = filterItems(items, '', { milestones: ['v1.1'] });
    assert.equal(res.length, 1);
    assert.equal(res[0].number, 3);
  });

  it('combines text query and chip filters (AND operation)', () => {
    const res = filterItems(items, 'refresh', { labels: ['bug'], authors: ['bob'] });
    assert.equal(res.length, 1);
    assert.equal(res[0].number, 2);

    const resMismatch = filterItems(items, 'refresh', { labels: ['docs'] });
    assert.equal(resMismatch.length, 0);
  });
});

describe('extractFilterOptions', () => {
  it('returns empty arrays for empty or non-array inputs', () => {
    assert.deepEqual(extractFilterOptions([]), { labels: [], authors: [], milestones: [] });
    assert.deepEqual(extractFilterOptions(null), { labels: [], authors: [], milestones: [] });
    assert.deepEqual(extractFilterOptions(undefined), { labels: [], authors: [], milestones: [] });
  });

  it('extracts unique, sorted labels, authors, and milestones', () => {
    const items = [
      { labels: ['bug', 'ui'], author: 'charlie', milestone: 'v2.0' },
      { labels: ['ui', 'backend'], author: 'alice', milestone: 'v1.0' },
      { labels: ['feature'], author: 'bob', milestone: 'v2.0' },
    ];
    const options = extractFilterOptions(items);
    assert.deepEqual(options.labels, ['backend', 'bug', 'feature', 'ui']);
    assert.deepEqual(options.authors, ['alice', 'bob', 'charlie']);
    assert.deepEqual(options.milestones, ['v1.0', 'v2.0']);
  });

  it('handles missing, nullish, or empty values defensively', () => {
    const items = [
      null,
      {},
      { labels: null, author: '', milestone: null },
      { labels: ['active', '', null], author: 'alice', milestone: 'v1.0' },
    ];
    const options = extractFilterOptions(items);
    assert.deepEqual(options.labels, ['active']);
    assert.deepEqual(options.authors, ['alice']);
    assert.deepEqual(options.milestones, ['v1.0']);
  });
});

describe('groupItemsByStatus', () => {
  const columns = [
    { id: 'todo', name: 'Todo' },
    { id: 'in_progress', name: 'In Progress' },
    { id: 'waiting', name: 'Waiting on User' },
    { id: 'in_review', name: 'In Review' },
  ];

  const items = [
    { id: '1', number: 1, status: 'Todo' },
    { id: '2', number: 2, status: 'In Progress' },
    { id: '3', number: 3, status: 'In Review' },
    { id: '4', number: 4, status: 'Waiting on User' },
    { id: '5', number: 5, status: 'Unknown' },
  ];

  it('groups items into sections according to status', () => {
    const grouped = groupItemsByStatus(columns, items);
    assert.equal(grouped.get('Todo')?.length, 1);
    assert.equal(grouped.get('In Progress')?.length, 1);
    assert.equal(grouped.get('In Review')?.length, 1);
    assert.equal(grouped.get('Waiting on User')?.length, 1);
    assert.equal(grouped.get('Unknown')?.length, 1);
  });

  it('initializes empty arrays for columns with no matching items', () => {
    const emptyItemsGrouped = groupItemsByStatus(columns, []);
    assert.equal(emptyItemsGrouped.get('Todo')?.length, 0);
    assert.equal(emptyItemsGrouped.get('In Progress')?.length, 0);
    assert.equal(emptyItemsGrouped.get('Waiting on User')?.length, 0);
    assert.equal(emptyItemsGrouped.get('In Review')?.length, 0);
  });
});

describe('createCardElement', () => {
  function createMockDocument() {
    return {
      createElement(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); el.className = Array.from(this.classes).join(' '); },
            remove(c) { this.classes.delete(c); el.className = Array.from(this.classes).join(' '); },
            contains(c) { return this.classes.has(c); },
          },
          style: {},
          attributes: {},
          children: [],
          textContent: '',
          innerHTML: '',
          href: '',
          target: '',
          rel: '',
          title: '',
          eventListeners: {},
          setAttribute(name, val) { this.attributes[name] = val; },
          getAttribute(name) { return this.attributes[name]; },
          appendChild(child) { this.children.push(child); return child; },
          addEventListener(event, fn) {
            if (!this.eventListeners[event]) this.eventListeners[event] = [];
            this.eventListeners[event].push(fn);
          },
          async dispatch(event, evObj = {}) {
            const fns = this.eventListeners[event] || [];
            for (const fn of fns) {
              await fn({ stopPropagation() {}, preventDefault() {}, ...evObj });
            }
          },
        };
        return el;
      },
    };
  }

  it('creates structured card element with direct links and badges', () => {
    const doc = createMockDocument();
    const item = {
      number: 42,
      title: 'Implement feature',
      url: 'https://github.com/org/repo/issues/42',
      action: 'NEEDS_PLAN',
      actionable: true,
      pullRequests: [
        {
          number: 100,
          title: 'PR for feature',
          url: 'https://github.com/org/repo/pull/100',
          state: 'OPEN',
          isDraft: false,
        },
      ],
    };

    const card = createCardElement(item, doc);
    assert.equal(card.className, 'card');
    assert.equal(card.children.length, 3); // cardTop, cardTitle, prsContainer

    const cardTop = card.children[0];
    const idLink = cardTop.children[0];
    assert.equal(idLink.href, item.url);
    assert.equal(idLink.textContent, '#42');

    const badgesContainer = cardTop.children[1];
    const badge = badgesContainer.children[0];
    assert.equal(badge.textContent, 'NEEDS_PLAN');
    assert.match(badge.className, /actionable/);

    const titleEl = card.children[1];
    assert.equal(titleEl.children[0].textContent, item.title);

    const prsContainer = card.children[2];
    assert.equal(prsContainer.children.length, 1);
    const prPill = prsContainer.children[0];
    assert.equal(prPill.href, 'https://github.com/org/repo/pull/100');
  });

  it('renders Run Worker button and copies command on click', async () => {
    let copiedText = '';
    const mockClipboard = {
      writeText: async (text) => { copiedText = text; },
    };

    const doc = createMockDocument();
    const item = {
      number: 105,
      title: 'Actionable item',
      url: 'https://github.com/org/repo/issues/105',
      action: 'NEEDS_PLAN',
      actionable: true,
      pullRequests: [],
    };

    const card = createCardElement(item, doc, mockClipboard);
    const cardTop = card.children[0];
    const badgesContainer = cardTop.children[1];

    // Find the run worker button
    const runBtn = badgesContainer.children.find((c) => c.className.includes('run-worker-btn'));
    assert.ok(runBtn, 'Run Worker button should be present in card header');
    assert.equal(runBtn.getAttribute('data-issue-number'), '105');
    assert.match(runBtn.innerHTML, /Run Worker/);

    // Simulate click
    await runBtn.dispatch('click');
    assert.equal(copiedText, '/github-worker #105');
    assert.match(runBtn.innerHTML, /Copied!/);
  });

  it('renders live CI & checks status badges on PR pills', () => {
    const doc = createMockDocument();
    const item = {
      number: 200,
      title: 'CI checks testing',
      url: 'https://github.com/org/repo/issues/200',
      action: 'USER_REPLIED',
      actionable: true,
      pullRequests: [
        { number: 1, title: 'Passing PR', url: 'https://github.com/org/repo/pull/1', state: 'OPEN', checksStatus: 'passing' },
        { number: 2, title: 'Failing PR', url: 'https://github.com/org/repo/pull/2', state: 'OPEN', checksStatus: 'failing' },
        { number: 3, title: 'Running PR', url: 'https://github.com/org/repo/pull/3', state: 'OPEN', checksStatus: 'running' },
        { number: 4, title: 'Pending PR', url: 'https://github.com/org/repo/pull/4', state: 'OPEN', checksStatus: 'pending' },
        { number: 5, title: 'No Checks PR', url: 'https://github.com/org/repo/pull/5', state: 'OPEN', checksStatus: null },
      ],
    };

    const card = createCardElement(item, doc);
    const prsContainer = card.children[2];
    assert.equal(prsContainer.children.length, 5);

    const [pillPassing, pillFailing, pillRunning, pillPending, pillNoChecks] = prsContainer.children;

    assert.match(pillPassing.innerHTML, /check-badge passing/);
    assert.match(pillPassing.innerHTML, /✓/);

    assert.match(pillFailing.innerHTML, /check-badge failing/);
    assert.match(pillFailing.innerHTML, /✕/);

    assert.match(pillRunning.innerHTML, /check-badge running/);
    assert.match(pillRunning.innerHTML, /●/);

    assert.match(pillPending.innerHTML, /check-badge pending/);
    assert.match(pillPending.innerHTML, /○/);

    assert.doesNotMatch(pillNoChecks.innerHTML, /check-badge/);
  });

  it('handles card with no action or PRs safely', () => {
    const doc = createMockDocument();
    const item = {
      number: 99,
      title: 'Simple task',
      url: 'https://github.com/org/repo/issues/99',
      action: 'NONE',
      actionable: false,
      pullRequests: [],
    };

    const card = createCardElement(item, doc);
    assert.equal(card.className, 'card');
    assert.equal(card.children.length, 2); // cardTop and cardTitle (no PRs container)
  });
});

describe('renderBoard', () => {
  it('renders stacked horizontal card sections into cards-container', () => {
    const mockElements = {
      'board-title': { textContent: '' },
      'repo-badge': { style: {}, textContent: '', title: '' },
      'cards-container': {
        innerHTML: '',
        children: [],
        appendChild(child) { this.children.push(child); return child; },
      },
    };
    const origDoc = globalThis.document;
    try {
      globalThis.document = {
        getElementById(id) { return mockElements[id] || null; },
        createElement(tag) {
          return {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            attributes: {},
            children: [],
            textContent: '',
            innerHTML: '',
            setAttribute(name, val) { this.attributes[name] = val; },
            appendChild(child) { this.children.push(child); return child; },
            addEventListener() {},
          };
        },
      };

      boardState.repository = { slug: 'owner/repo', source: 'git' };
      boardState.columns = [
        { id: 'todo', name: 'Todo', color: '#89b4fa' },
        { id: 'in_progress', name: 'In Progress', color: '#fab387' },
      ];
      boardState.items = [
        { number: 1, title: 'Issue 1', status: 'Todo', action: 'NEEDS_PLAN', actionable: true, pullRequests: [] },
      ];
      boardState.filterQuery = '';

      renderBoard();

      assert.equal(mockElements['board-title'].textContent, 'GitHub Worker Board');
      assert.equal(mockElements['repo-badge'].textContent, 'owner/repo');
      assert.equal(mockElements['cards-container'].children.length, 2); // 2 sections

      const todoSection = mockElements['cards-container'].children[0];
      assert.match(todoSection.className, /board-section/);
      assert.equal(todoSection.children.length, 2); // header, cards body
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('filters items in renderBoard based on active chip filters', () => {
    const mockElements = {
      'board-title': { textContent: '' },
      'repo-badge': { style: {}, textContent: '', title: '' },
      'cards-container': {
        innerHTML: '',
        children: [],
        appendChild(child) { this.children.push(child); return child; },
      },
      'filter-chips-container': {
        innerHTML: '',
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
      },
    };
    const origDoc = globalThis.document;
    try {
      globalThis.document = {
        getElementById(id) { return mockElements[id] || null; },
        createElement(tag) {
          return {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            attributes: {},
            children: [],
            textContent: '',
            innerHTML: '',
            setAttribute(name, val) { this.attributes[name] = val; },
            appendChild(child) { this.children.push(child); return child; },
            addEventListener() {},
          };
        },
      };

      boardState.repository = { slug: 'owner/repo', source: 'git' };
      boardState.columns = [{ id: 'todo', name: 'Todo' }];
      boardState.items = [
        { number: 1, title: 'Item 1', status: 'Todo', labels: ['bug'], author: 'alice' },
        { number: 2, title: 'Item 2', status: 'Todo', labels: ['feature'], author: 'bob' },
      ];
      boardState.filterQuery = '';
      boardState.selectedLabels = ['feature'];
      boardState.selectedAuthors = [];
      boardState.selectedMilestones = [];

      renderBoard();

      // Only Item 2 matches 'feature'
      const todoSection = mockElements['cards-container'].children[0];
      const sectionCards = todoSection.children[1];
      assert.equal(sectionCards.children.length, 1);
    } finally {
      boardState.selectedLabels = [];
      globalThis.document = origDoc;
    }
  });
});

describe('Countdown Timer', () => {
  it('POLL_INTERVAL_SECONDS is 30', () => {
    assert.equal(POLL_INTERVAL_SECONDS, 30);
  });

  it('resetCountdown sets countdown to 30 and updates DOM', () => {
    const mockDoc = {
      getElementById(id) {
        if (id === 'countdown-timer') {
          return { textContent: '' };
        }
        return null;
      },
    };

    boardState.countdownSeconds = 5;
    resetCountdown(mockDoc);
    assert.equal(boardState.countdownSeconds, 30);
  });

  it('tickCountdown decrements by 1 and updates display', () => {
    const timerEl = { textContent: '' };
    const mockDoc = {
      getElementById(id) {
        if (id === 'countdown-timer') return timerEl;
        return null;
      },
    };

    boardState.countdownSeconds = 15;
    tickCountdown(() => {}, mockDoc);
    assert.equal(boardState.countdownSeconds, 14);
    assert.equal(timerEl.textContent, '14s');
  });

  it('tickCountdown triggers onExpire and resets to 30 when reaching 0', () => {
    let expired = false;
    const timerEl = { textContent: '' };
    const mockDoc = {
      getElementById(id) {
        if (id === 'countdown-timer') return timerEl;
        return null;
      },
    };

    boardState.countdownSeconds = 1;
    tickCountdown(() => { expired = true; }, mockDoc);
    assert.equal(expired, true);
    assert.equal(boardState.countdownSeconds, 30);
  });
});

describe('Filter Chips UI', () => {
  it('toggleFilter toggles label, author, or milestone filters', () => {
    boardState.selectedLabels = [];
    boardState.selectedAuthors = [];
    boardState.selectedMilestones = [];

    toggleFilter('labels', 'bug');
    assert.deepEqual(boardState.selectedLabels, ['bug']);

    toggleFilter('labels', 'bug');
    assert.deepEqual(boardState.selectedLabels, []);

    toggleFilter('authors', 'alice');
    assert.deepEqual(boardState.selectedAuthors, ['alice']);

    toggleFilter('milestones', 'v1.0');
    assert.deepEqual(boardState.selectedMilestones, ['v1.0']);
  });

  it('clearFilters resets all active filter selections', () => {
    boardState.selectedLabels = ['bug'];
    boardState.selectedAuthors = ['alice'];
    boardState.selectedMilestones = ['v1.0'];

    clearFilters();
    assert.deepEqual(boardState.selectedLabels, []);
    assert.deepEqual(boardState.selectedAuthors, []);
    assert.deepEqual(boardState.selectedMilestones, []);
  });

  it('renderFilterChips creates clickable chip elements with active classes', () => {
    const chips = [];
    const container = {
      innerHTML: '',
      style: {},
      children: chips,
      appendChild(child) { this.children.push(child); return child; },
    };
    const mockDoc = {
      createElement(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          textContent: '',
          attributes: {},
          eventListeners: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          addEventListener(ev, fn) { this.eventListeners[ev] = fn; },
        };
        return el;
      },
    };

    const options = {
      labels: ['bug', 'feature'],
      authors: ['alice'],
      milestones: ['v1.0'],
    };
    const activeFilters = {
      labels: ['bug'],
      authors: [],
      milestones: [],
    };

    let toggledType = null;
    let toggledVal = null;
    const onToggle = (type, val) => {
      toggledType = type;
      toggledVal = val;
    };

    renderFilterChips(container, options, activeFilters, onToggle, mockDoc);

    // 2 labels + 1 author + 1 milestone + 1 clear-all = 5 chips
    assert.equal(container.children.length, 5);

    const bugChip = container.children.find((c) => c.attributes['data-filter-value'] === 'bug');
    assert.ok(bugChip);
    assert.match(bugChip.className, /active/);

    const featureChip = container.children.find((c) => c.attributes['data-filter-value'] === 'feature');
    assert.ok(featureChip);
    assert.doesNotMatch(featureChip.className, /active/);

    // Test click on feature chip
    featureChip.eventListeners['click']();
    assert.equal(toggledType, 'labels');
    assert.equal(toggledVal, 'feature');

    // Clear filters button exists
    const clearBtn = container.children.find((c) => c.className.includes('clear-chip'));
    assert.ok(clearBtn);
  });
});
