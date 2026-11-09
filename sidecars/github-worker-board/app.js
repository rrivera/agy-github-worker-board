// GitHub Worker Board Sidecar Client Application

export const boardState = {
  repository: null,
  columns: [],
  items: [],
  lastUpdated: null,
  activeWorkspaceUri: null,
  userOverrideRepo: '',
  filterQuery: '',
  selectedLabels: [],
  selectedAuthors: [],
  selectedMilestones: [],
  countdownSeconds: 30,
  isRefreshing: false,
};

export const COLUMN_COLORS = {
  'Todo': 'var(--status-todo)',
  'In progress': 'var(--status-in-progress)',
  'In Progress': 'var(--status-in-progress)',
  'Waiting on User': 'var(--status-waiting)',
  'In review': 'var(--status-in-review)',
  'In Review': 'var(--status-in-review)',
};

/**
 * Escapes special HTML characters defensively to mitigate XSS vulnerabilities.
 * Safely handles strings, numbers, null, and undefined values.
 *
 * @param {*} str - Input value to escape.
 * @returns {string} Escaped string.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes string casing with capitalized first letter.
 *
 * @param {string} s - Input string.
 * @returns {string} Capitalized string.
 */
export function capitalize(s) {
  if (!s) return '';
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Extracts unique, sorted lists of available labels, authors, and milestones
 * from an array of board items.
 *
 * @param {Array<object>} items - Board items.
 * @returns {{ labels: string[], authors: string[], milestones: string[] }}
 */
export function extractFilterOptions(items) {
  const labelsSet = new Set();
  const authorsSet = new Set();
  const milestonesSet = new Set();

  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item) continue;

      if (Array.isArray(item.labels)) {
        for (const l of item.labels) {
          const name = typeof l === 'string' ? l.trim() : (l?.name || '').trim();
          if (name) labelsSet.add(name);
        }
      }

      const author = typeof item.author === 'string' ? item.author.trim() : (item.author?.login || '').trim();
      if (author) authorsSet.add(author);

      const milestone = typeof item.milestone === 'string' ? item.milestone.trim() : (item.milestone?.title || '').trim();
      if (milestone) milestonesSet.add(milestone);
    }
  }

  return {
    labels: Array.from(labelsSet).sort((a, b) => a.localeCompare(b)),
    authors: Array.from(authorsSet).sort((a, b) => a.localeCompare(b)),
    milestones: Array.from(milestonesSet).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Filters board items against search query and active filter chips (labels, authors, milestones).
 *
 * @param {Array<object>} items - Array of board items.
 * @param {string} [query=''] - Search query.
 * @param {object} [activeFilters={}] - Active filters map.
 * @param {Array<string>} [activeFilters.labels=[]] - Selected label filters.
 * @param {Array<string>} [activeFilters.authors=[]] - Selected author filters.
 * @param {Array<string>} [activeFilters.milestones=[]] - Selected milestone filters.
 * @returns {Array<object>} Filtered items array.
 */
export function filterItems(items, query = '', activeFilters = {}) {
  if (!Array.isArray(items)) return [];
  const q = (query || '').trim().toLowerCase();
  const selectedLabels = Array.isArray(activeFilters?.labels) ? activeFilters.labels : [];
  const selectedAuthors = Array.isArray(activeFilters?.authors) ? activeFilters.authors : [];
  const selectedMilestones = Array.isArray(activeFilters?.milestones) ? activeFilters.milestones : [];

  return items.filter((item) => {
    if (!item) return false;

    // 1. Text search query match
    if (q) {
      const matchNum = item.number != null && String(item.number).includes(q);
      const matchTitle = item.title && item.title.toLowerCase().includes(q);
      const matchAction = item.action && item.action.toLowerCase().includes(q);
      const matchPr = Array.isArray(item.pullRequests) && item.pullRequests.some((pr) =>
        (pr?.number != null && String(pr.number).includes(q)) ||
        (pr?.title && pr.title.toLowerCase().includes(q))
      );
      if (!matchNum && !matchTitle && !matchAction && !matchPr) {
        return false;
      }
    }

    // 2. Active label filters match (item must have all selected labels)
    if (selectedLabels.length > 0) {
      const itemLabels = Array.isArray(item.labels)
        ? item.labels.map((l) => (typeof l === 'string' ? l : l?.name || ''))
        : [];
      const hasAllLabels = selectedLabels.every((sel) => itemLabels.includes(sel));
      if (!hasAllLabels) return false;
    }

    // 3. Active author filters match (item must match one of selected authors)
    if (selectedAuthors.length > 0) {
      const itemAuthor = typeof item.author === 'string' ? item.author : (item.author?.login || '');
      if (!selectedAuthors.includes(itemAuthor)) return false;
    }

    // 4. Active milestone filters match (item must match one of selected milestones)
    if (selectedMilestones.length > 0) {
      const itemMilestone = typeof item.milestone === 'string' ? item.milestone : (item.milestone?.title || '');
      if (!selectedMilestones.includes(itemMilestone)) return false;
    }

    return true;
  });
}

/**
 * Groups items into a Map indexed by column/status name.
 * Pre-populates buckets for all configured columns.
 *
 * @param {Array<object>} columns - Configured columns.
 * @param {Array<object>} items - Board items to group.
 * @returns {Map<string, Array<object>>} Map of status names to items.
 */
export function groupItemsByStatus(columns, items) {
  const map = new Map();
  const validCols = Array.isArray(columns) ? columns : [];
  for (const col of validCols) {
    map.set(col.name, []);
  }

  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (!item) continue;
    const status = item.status || 'Todo';
    if (!map.has(status)) {
      map.set(status, []);
    }
    map.get(status).push(item);
  }

  return map;
}

/**
 * Fetch wrapper that prioritizes window.sidecar.fetch when running in Antigravity.
 *
 * @param {string} url - Request URL.
 * @param {object} [options={}] - Fetch options.
 * @returns {Promise<Response>} Fetch response.
 */
export async function apiFetch(url, options = {}) {
  if (typeof window !== 'undefined' && window.sidecar && typeof window.sidecar.fetch === 'function') {
    return window.sidecar.fetch(url, options);
  }
  return fetch(url, options);
}

/**
 * Resolves current workspace URI from window.sidecar when available.
 * Uses a safe timeout race to prevent indefinite suspension if host events are delayed.
 *
 * @param {number} [timeoutMs=2000] - Timeout in milliseconds for resolution.
 * @returns {Promise<string>} Workspace URI or empty string.
 */
export async function resolveWorkspaceUri(timeoutMs = 2000) {
  if (typeof window !== 'undefined' && window.sidecar && typeof window.sidecar.getWorkspaceUris === 'function') {
    try {
      const urisPromise = window.sidecar.getWorkspaceUris();
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs));
      const uris = await Promise.race([urisPromise, timeoutPromise]);
      if (Array.isArray(uris) && uris.length > 0) {
        return uris[0];
      }
    } catch (e) {
      console.warn('Could not get workspace uris from sidecar:', e);
    }
  }
  return '';
}

/**
 * Creates DOM node for an issue card with direct links, action badges, and Run Worker action.
 * Accepts an injectable document context and clipboard API for unit testability in non-browser environments.
 *
 * @param {object} item - Issue card item data.
 * @param {Document|object} [doc=(typeof document !== 'undefined' ? document : null)] - DOM document context.
 * @param {object} [clipboardApi=(typeof navigator !== 'undefined' ? navigator.clipboard : null)] - Clipboard interface.
 * @returns {HTMLElement|null}
 */
export function createCardElement(
  item,
  doc = (typeof document !== 'undefined' ? document : null),
  clipboardApi = (typeof navigator !== 'undefined' ? navigator.clipboard : null)
) {
  if (!doc || !doc.createElement || !item) return null;

  const card = doc.createElement('div');
  card.className = 'card';

  // Card Header (Direct Issue Link + Action Badge + Run Worker Action)
  const cardTop = doc.createElement('div');
  cardTop.className = 'card-top';

  const idLink = doc.createElement('a');
  idLink.className = 'card-id';
  idLink.href = item.url || '#';
  idLink.target = '_blank';
  idLink.rel = 'noopener noreferrer';
  idLink.textContent = item.number ? `#${item.number}` : 'Issue';
  idLink.title = 'Open issue on GitHub';

  const badgesContainer = doc.createElement('div');
  badgesContainer.className = 'card-badges';

  if (item.action && item.action !== 'NONE') {
    const actionBadge = doc.createElement('span');
    const isActionable = Boolean(item.actionable);
    actionBadge.className = `action-badge ${isActionable ? 'actionable' : 'waiting'}`;
    actionBadge.textContent = item.action;
    badgesContainer.appendChild(actionBadge);
  }

  // "Run Worker on Issue" action button
  if (item.number) {
    const runBtn = doc.createElement('button');
    runBtn.className = 'run-worker-btn';
    runBtn.setAttribute('data-issue-number', String(item.number));
    runBtn.setAttribute('title', `Run worker on issue #${item.number}`);
    runBtn.innerHTML = '<span>⚡ Run Worker</span>';

    runBtn.addEventListener('click', async (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const cmd = `/github-worker #${item.number}`;
      try {
        if (clipboardApi && typeof clipboardApi.writeText === 'function') {
          await clipboardApi.writeText(cmd);
        } else if (typeof navigator !== 'undefined' && navigator?.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(cmd);
        }
        if (runBtn.classList && typeof runBtn.classList.add === 'function') {
          runBtn.classList.add('copied');
        }
        runBtn.innerHTML = '<span>✓ Copied!</span>';
        setTimeout(() => {
          if (runBtn.classList && typeof runBtn.classList.remove === 'function') {
            runBtn.classList.remove('copied');
          }
          runBtn.innerHTML = '<span>⚡ Run Worker</span>';
        }, 2000);
      } catch (err) {
        console.warn('Could not copy command to clipboard:', err);
      }
    });

    badgesContainer.appendChild(runBtn);
  }

  cardTop.appendChild(idLink);
  cardTop.appendChild(badgesContainer);
  card.appendChild(cardTop);

  // Card Title with direct issue link
  const cardTitle = doc.createElement('div');
  cardTitle.className = 'card-title';
  const titleLink = doc.createElement('a');
  titleLink.href = item.url || '#';
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = item.title || '';
  titleLink.title = 'Open issue on GitHub';
  cardTitle.appendChild(titleLink);
  card.appendChild(cardTitle);

  // Associated PRs with direct links and live CI check badges
  if (Array.isArray(item.pullRequests) && item.pullRequests.length > 0) {
    const prsContainer = doc.createElement('div');
    prsContainer.className = 'card-prs';

    for (const pr of item.pullRequests) {
      if (!pr) continue;
      const prPill = doc.createElement('a');
      const prState = (pr.state || 'OPEN').toLowerCase();
      prPill.className = `pr-pill ${prState} ${pr.isDraft ? 'draft' : ''}`;
      prPill.href = pr.url || '#';
      prPill.target = '_blank';
      prPill.rel = 'noopener noreferrer';
      prPill.title = pr.title || `Pull Request #${pr.number}`;

      const stateLabel = pr.isDraft ? 'Draft' : capitalize(prState);
      let checkBadgeHtml = '';
      if (pr.checksStatus) {
        const symbolMap = {
          passing: '✓',
          failing: '✕',
          running: '●',
          pending: '○',
        };
        const symbol = symbolMap[pr.checksStatus] || '●';
        checkBadgeHtml = ` <span class="check-badge ${escapeHtml(pr.checksStatus)}" title="CI: ${escapeHtml(pr.checksStatus)}">${symbol}</span>`;
      }
      prPill.innerHTML = `<span>⑂ #${pr.number}</span> <span style="font-size: 10px; opacity: 0.85;">(${escapeHtml(stateLabel)})</span>${checkBadgeHtml}`;
      prsContainer.appendChild(prPill);
    }

    card.appendChild(prsContainer);
  }

  return card;
}

export const POLL_INTERVAL_SECONDS = 30;

/**
 * Updates the countdown timer display in the DOM.
 *
 * @param {Document|object} [doc=(typeof document !== 'undefined' ? document : null)] - DOM document context.
 */
export function updateCountdownDisplay(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || typeof doc.getElementById !== 'function') return;
  const el = doc.getElementById('countdown-timer');
  if (el) {
    el.textContent = `${boardState.countdownSeconds}s`;
  }
}

/**
 * Resets the countdown timer to the poll interval and updates the display.
 *
 * @param {Document|object} [doc=(typeof document !== 'undefined' ? document : null)] - DOM document context.
 */
export function resetCountdown(doc = (typeof document !== 'undefined' ? document : null)) {
  boardState.countdownSeconds = POLL_INTERVAL_SECONDS;
  updateCountdownDisplay(doc);
}

/**
 * Decrements the countdown timer by 1 second. Triggers onExpire and resets when it reaches 0.
 *
 * @param {Function} [onExpire=loadBoard] - Callback invoked when timer hits 0.
 * @param {Document|object} [doc=(typeof document !== 'undefined' ? document : null)] - DOM document context.
 */
export function tickCountdown(onExpire = loadBoard, doc = (typeof document !== 'undefined' ? document : null)) {
  boardState.countdownSeconds -= 1;
  if (boardState.countdownSeconds <= 0) {
    resetCountdown(doc);
    if (typeof onExpire === 'function') {
      onExpire();
    }
  } else {
    updateCountdownDisplay(doc);
  }
}

/**
 * Toggles an active filter chip for labels, authors, or milestones and re-renders the board.
 *
 * @param {'labels' | 'authors' | 'milestones'} type - Filter category.
 * @param {string} value - Filter value to toggle.
 */
export function toggleFilter(type, value) {
  if (!['labels', 'authors', 'milestones'].includes(type)) return;
  const prop = `selected${capitalize(type)}`;
  const list = boardState[prop] || [];
  const idx = list.indexOf(value);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push(value);
  }
  renderBoard();
}

/**
 * Clears all active filter selections and re-renders the board.
 */
export function clearFilters() {
  boardState.selectedLabels = [];
  boardState.selectedAuthors = [];
  boardState.selectedMilestones = [];
  renderBoard();
}

/**
 * Renders interactive filter chips into the specified DOM container.
 *
 * @param {HTMLElement|object} container - DOM container element.
 * @param {object} options - Available filter options { labels, authors, milestones }.
 * @param {object} [activeFilters={}] - Active filters map.
 * @param {Function} [onToggle=toggleFilter] - Callback when chip is toggled.
 * @param {Document|object} [doc=(typeof document !== 'undefined' ? document : null)] - DOM document context.
 */
export function renderFilterChips(
  container,
  options,
  activeFilters = {},
  onToggle = toggleFilter,
  doc = (typeof document !== 'undefined' ? document : null)
) {
  if (!container || !doc || typeof doc.createElement !== 'function') return;
  container.innerHTML = '';

  const { labels = [], authors = [], milestones = [] } = options || {};
  const selectedLabels = Array.isArray(activeFilters.labels) ? activeFilters.labels : [];
  const selectedAuthors = Array.isArray(activeFilters.authors) ? activeFilters.authors : [];
  const selectedMilestones = Array.isArray(activeFilters.milestones) ? activeFilters.milestones : [];

  const hasActive = selectedLabels.length > 0 || selectedAuthors.length > 0 || selectedMilestones.length > 0;
  if (labels.length === 0 && authors.length === 0 && milestones.length === 0) {
    if (container.style) container.style.display = 'none';
    return;
  }
  if (container.style) container.style.display = 'flex';

  // Render Label Chips
  for (const label of labels) {
    const chip = doc.createElement('button');
    const isActive = selectedLabels.includes(label);
    chip.className = `filter-chip label-chip ${isActive ? 'active' : ''}`;
    chip.setAttribute('type', 'button');
    chip.setAttribute('data-filter-type', 'labels');
    chip.setAttribute('data-filter-value', label);
    chip.innerHTML = `<span class="chip-label">${escapeHtml(label)}</span>`;
    chip.addEventListener('click', () => {
      if (typeof onToggle === 'function') onToggle('labels', label);
    });
    container.appendChild(chip);
  }

  // Render Author Chips
  for (const author of authors) {
    const chip = doc.createElement('button');
    const isActive = selectedAuthors.includes(author);
    chip.className = `filter-chip author-chip ${isActive ? 'active' : ''}`;
    chip.setAttribute('type', 'button');
    chip.setAttribute('data-filter-type', 'authors');
    chip.setAttribute('data-filter-value', author);
    chip.innerHTML = `<span class="chip-label">@${escapeHtml(author)}</span>`;
    chip.addEventListener('click', () => {
      if (typeof onToggle === 'function') onToggle('authors', author);
    });
    container.appendChild(chip);
  }

  // Render Milestone Chips
  for (const milestone of milestones) {
    const chip = doc.createElement('button');
    const isActive = selectedMilestones.includes(milestone);
    chip.className = `filter-chip milestone-chip ${isActive ? 'active' : ''}`;
    chip.setAttribute('type', 'button');
    chip.setAttribute('data-filter-type', 'milestones');
    chip.setAttribute('data-filter-value', milestone);
    chip.innerHTML = `<span class="chip-label">🏁 ${escapeHtml(milestone)}</span>`;
    chip.addEventListener('click', () => {
      if (typeof onToggle === 'function') onToggle('milestones', milestone);
    });
    container.appendChild(chip);
  }

  // Clear filters button if any active
  if (hasActive) {
    const clearBtn = doc.createElement('button');
    clearBtn.className = 'filter-chip clear-chip';
    clearBtn.setAttribute('type', 'button');
    clearBtn.textContent = 'Clear filters';
    clearBtn.addEventListener('click', () => {
      clearFilters();
    });
    container.appendChild(clearBtn);
  }
}

/**
 * Fetches the issue board data from backend and updates UI.
 */
export async function loadBoard() {
  if (boardState.isRefreshing) return;
  boardState.isRefreshing = true;

  const refreshBtn = typeof document !== 'undefined' ? document.getElementById('refresh-btn') : null;
  const errorBanner = typeof document !== 'undefined' ? document.getElementById('error-banner') : null;
  const errorMsg = typeof document !== 'undefined' ? document.getElementById('error-message') : null;
  const promptBanner = typeof document !== 'undefined' ? document.getElementById('repo-prompt-banner') : null;
  const statusBar = typeof document !== 'undefined' ? document.getElementById('last-updated-text') : null;
  const changeRepoBtn = typeof document !== 'undefined' ? document.getElementById('change-repo-btn') : null;

  refreshBtn?.classList.add('spinning');
  if (errorBanner) errorBanner.style.display = 'none';

  try {
    if (!boardState.activeWorkspaceUri) {
      boardState.activeWorkspaceUri = await resolveWorkspaceUri();
    }

    const params = new URLSearchParams();
    if (boardState.activeWorkspaceUri) {
      params.set('workspaceUri', boardState.activeWorkspaceUri);
    }
    if (boardState.userOverrideRepo) {
      params.set('targetRepo', boardState.userOverrideRepo);
    }

    const endpoint = `/api/issues?${params.toString()}`;
    const res = await apiFetch(endpoint);
    if (!res.ok) {
      const text = await res.text();
      let parsedErr = text;
      try {
        parsedErr = JSON.parse(text).error || text;
      } catch (_) {}
      throw new Error(parsedErr || `HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.needsTargetRepo) {
      if (promptBanner) promptBanner.style.display = 'block';
      if (statusBar) statusBar.textContent = 'Awaiting target repository';
      boardState.repository = null;
      boardState.items = [];
      renderBoard();
      return;
    }

    if (promptBanner) promptBanner.style.display = 'none';
    if (changeRepoBtn) changeRepoBtn.style.display = 'inline-flex';

    boardState.repository = data.repository;
    boardState.columns = data.columns || [];
    boardState.items = data.items || [];
    boardState.lastUpdated = data.lastUpdated;

    resetCountdown();
    renderBoard();

    if (boardState.lastUpdated && statusBar) {
      const timeStr = new Date(boardState.lastUpdated).toLocaleTimeString();
      const actionableCount = boardState.items.filter((i) => i.actionable).length;
      statusBar.textContent = `Updated at ${timeStr} • ${boardState.items.length} items (${actionableCount} actionable)`;
    }
  } catch (err) {
    console.error('Failed to load issues board:', err);
    if (errorMsg) errorMsg.textContent = `Error: ${err.message}`;
    if (errorBanner) errorBanner.style.display = 'flex';
    if (statusBar) statusBar.textContent = 'Update failed';
  } finally {
    boardState.isRefreshing = false;
    refreshBtn?.classList.remove('spinning');
  }
}

/**
 * Renders the stacked horizontal cards grouped cleanly by status into the DOM.
 */
export function renderBoard() {
  if (typeof document === 'undefined') return;

  const boardTitleEl = document.getElementById('board-title');
  const repoBadgeEl = document.getElementById('repo-badge');
  const cardsContainer = document.getElementById('cards-container') || document.getElementById('columns-container');
  if (!cardsContainer) return;

  if (boardState.repository && boardState.repository.slug) {
    if (boardTitleEl) boardTitleEl.textContent = 'GitHub Worker Board';
    if (repoBadgeEl) {
      repoBadgeEl.textContent = boardState.repository.slug;
      repoBadgeEl.style.display = 'inline-flex';
      repoBadgeEl.title = `Source: ${boardState.repository.source}`;
    }
  } else if (repoBadgeEl) {
    repoBadgeEl.style.display = 'none';
  }

  const activeFilters = {
    labels: boardState.selectedLabels,
    authors: boardState.selectedAuthors,
    milestones: boardState.selectedMilestones,
  };
  const filteredItems = filterItems(boardState.items, boardState.filterQuery, activeFilters);
  const itemsByStatus = groupItemsByStatus(boardState.columns, filteredItems);

  // Render filter chips
  const chipsContainer = document.getElementById('filter-chips-container');
  if (chipsContainer) {
    const options = extractFilterOptions(boardState.items);
    renderFilterChips(chipsContainer, options, activeFilters, toggleFilter, document);
  }

  cardsContainer.innerHTML = '';

  for (const col of boardState.columns) {
    const itemsInCol = itemsByStatus.get(col.name) || [];
    const colColor = col.color || COLUMN_COLORS[col.name] || 'var(--primary-color)';

    const sectionEl = document.createElement('div');
    sectionEl.className = 'board-section column';
    sectionEl.setAttribute('data-col-id', col.id);

    // Section Header
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-header column-header';
    sectionHeader.innerHTML = `
      <div class="section-header-title column-header-title">
        <span class="section-dot column-dot" style="background-color: ${escapeHtml(colColor)};"></span>
        <span>${escapeHtml(col.name)}</span>
      </div>
      <span class="section-count column-count">${itemsInCol.length}</span>
    `;

    sectionHeader.addEventListener('click', () => {
      sectionEl.classList.toggle('collapsed');
    });

    // Section Cards Body
    const cardsEl = document.createElement('div');
    cardsEl.className = 'section-cards column-cards';

    if (itemsInCol.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'empty-section empty-column';
      emptyEl.style.cssText = 'color: var(--muted-fg); font-size: 11px; text-align: center; padding: 12px 8px;';
      emptyEl.textContent = 'No items';
      cardsEl.appendChild(emptyEl);
    } else {
      for (const item of itemsInCol) {
        const cardNode = createCardElement(item, document);
        if (cardNode) {
          cardsEl.appendChild(cardNode);
        }
      }
    }

    sectionEl.appendChild(sectionHeader);
    sectionEl.appendChild(cardsEl);
    cardsContainer.appendChild(sectionEl);
  }
}

/**
 * Initializes DOM event listeners and triggers initial board load.
 */
function initApp() {
  const refreshBtn = document.getElementById('refresh-btn');
  const retryBtn = document.getElementById('retry-btn');
  const filterInput = document.getElementById('filter-input');
  const changeRepoBtn = document.getElementById('change-repo-btn');
  const repoForm = document.getElementById('repo-form');
  const repoInput = document.getElementById('repo-input');
  const promptBanner = document.getElementById('repo-prompt-banner');

  const handleManualRefresh = () => {
    resetCountdown();
    loadBoard();
  };

  refreshBtn?.addEventListener('click', handleManualRefresh);
  retryBtn?.addEventListener('click', handleManualRefresh);

  changeRepoBtn?.addEventListener('click', () => {
    promptBanner.style.display = promptBanner.style.display === 'none' ? 'block' : 'none';
    if (promptBanner.style.display === 'block') {
      repoInput?.focus();
    }
  });

  repoForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (repoInput?.value || '').trim();
    if (val && val.includes('/')) {
      boardState.userOverrideRepo = val;
      loadBoard();
    }
  });

  filterInput?.addEventListener('input', (e) => {
    boardState.filterQuery = e.target.value;
    renderBoard();
  });

  // Re-resolve and reload when workspace changes in Antigravity
  if (window.sidecar && typeof window.sidecar.onWorkspaceChange === 'function') {
    window.sidecar.onWorkspaceChange((uris) => {
      if (Array.isArray(uris) && uris.length > 0) {
        boardState.activeWorkspaceUri = uris[0];
        boardState.userOverrideRepo = '';
        loadBoard();
      }
    });
  }

  // Initial load
  loadBoard();

  // Countdown timer ticking every second, auto-refreshing every 30s
  setInterval(() => {
    tickCountdown(loadBoard);
  }, 1000);
}

// Event Listeners setup for browser execution
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
