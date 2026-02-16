/**
 * Wedding Planner Premium — Optimized Engine
 * Performance-focused refactor:
 *   - Event delegation (single listener per container)
 *   - Batched DOM writes via DocumentFragment
 *   - requestAnimationFrame for render scheduling
 *   - Debounced search input
 *   - Cached computed values
 *   - Zero DOM thrashing (read-then-write pattern)
 *   - GPU-accelerated progress bar via scaleX
 *
 * Author: Elad (Senior Full Stack)
 */

const WeddingApp = {

    // ─── Configuration ───
    DB_KEY: 'wedding_app_db_v2',
    _renderQueued: false,
    _cachedTotals: null,

    // ─── State ───
    data: {
        settings: {
            total_budget: 100000,
            groom_name: "החתן",
            bride_name: "הכלה",
            wedding_date: "2026-06-15"
        },
        expenses: [],
        guests: []
    },

    // ═══════════════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════════════

    init() {
        this.loadData();
        this.cacheDOM();
        this.bindEvents();
        this.renderDashboard();
        this.startCountdown();

        // Reveal app content, hide skeleton
        document.body.classList.add('app-ready');
    },

    // ─── DOM Cache (one-time lookup) ───
    cacheDOM() {
        const $ = (id) => document.getElementById(id);
        this.dom = {
            namesDisplay:   $('namesDisplay'),
            dateDisplay:    $('countdownDisplay'),
            budgetTotal:    $('budgetTotal'),
            budgetSpent:    $('budgetSpent'),
            budgetLeft:     $('budgetLeft'),
            budgetProgress: $('budgetProgress'),
            totalGuests:    $('totalGuests'),
            totalGifts:     $('totalGifts'),
            expensesList:   $('expensesList'),
            guestsList:     $('guestsList'),
            modal:          $('itemModal'),
            modalTitle:     $('modalTitle'),
            modalBody:      $('modalBody'),
            modalActionBtn: $('modalActionBtn'),
            modalCloseBtn:  $('modalCloseBtn'),
            guestSearch:    $('guestSearch'),
            btnOpenSettings:$('btnOpenSettings'),
            btnAddExpense:  $('btnAddExpense'),
            btnAddGuest:    $('btnAddGuest'),
            bottomNav:      document.querySelector('.bottom-nav')
        };
    },

    // ═══════════════════════════════════════════════
    //  EVENT BINDING — Delegation Pattern
    // ═══════════════════════════════════════════════

    bindEvents() {
        // Navigation — single delegated listener on nav container
        this.dom.bottomNav.addEventListener('click', (e) => {
            const navItem = e.target.closest('.nav-item');
            if (!navItem) return;
            const tabId = navItem.dataset.tab;
            if (tabId) this.switchTab(tabId);
        });

        // Keyboard support for settings card
        this.dom.btnOpenSettings.addEventListener('click', () => this.openSettingsModal());
        this.dom.btnOpenSettings.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openSettingsModal();
            }
        });

        // Modal triggers
        this.dom.btnAddExpense.addEventListener('click', () => this.openExpenseModal());
        this.dom.btnAddGuest.addEventListener('click', () => this.openGuestModal());

        // Close modal — single handler
        this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());
        this.dom.modal.addEventListener('click', (e) => {
            if (e.target === this.dom.modal) this.closeModal();
        });

        // Escape key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.dom.modal.classList.contains('show')) {
                this.closeModal();
            }
        });

        // Search — debounced (300ms)
        this.dom.guestSearch.addEventListener('input', this._debounce((e) => {
            this.renderGuests(e.target.value);
        }, 300));

        // Expenses list — delegated click for delete buttons
        this.dom.expensesList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('[data-action="delete"]');
            if (!deleteBtn) return;
            const index = parseInt(deleteBtn.dataset.index, 10);
            this.deleteItem('expenses', index);
        });

        // Guests list — delegated click for delete buttons
        this.dom.guestsList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('[data-action="delete"]');
            if (!deleteBtn) return;
            const index = parseInt(deleteBtn.dataset.index, 10);
            this.deleteItem('guests', index);
        });
    },

    // ═══════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════

    loadData() {
        try {
            const saved = localStorage.getItem(this.DB_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Merge with defaults (handles missing keys from older versions)
                this.data = {
                    settings: { ...this.data.settings, ...parsed.settings },
                    expenses: parsed.expenses || [],
                    guests: parsed.guests || []
                };
            } else {
                this.saveData();
            }
        } catch (e) {
            console.error("Storage Error:", e);
        }
    },

    saveData() {
        try {
            localStorage.setItem(this.DB_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.error("Storage Save Error:", e);
        }
        // Invalidate computed cache
        this._cachedTotals = null;
        // Schedule render on next frame
        this._scheduleRender();
    },

    // ═══════════════════════════════════════════════
    //  COMPUTED VALUES (Cached)
    // ═══════════════════════════════════════════════

    _computeTotals() {
        if (this._cachedTotals) return this._cachedTotals;

        let totalSpent = 0;
        let totalGuests = 0;
        let totalGifts = 0;

        // Single pass through expenses
        const expenses = this.data.expenses;
        for (let i = 0, len = expenses.length; i < len; i++) {
            totalSpent += Number(expenses[i].paid_amount) || 0;
        }

        // Single pass through guests
        const guests = this.data.guests;
        for (let i = 0, len = guests.length; i < len; i++) {
            totalGuests += Number(guests[i].total_people) || 1;
            totalGifts += Number(guests[i].gift) || 0;
        }

        this._cachedTotals = {
            totalSpent,
            totalGuests,
            totalGifts,
            remaining: this.data.settings.total_budget - totalSpent
        };

        return this._cachedTotals;
    },

    // ═══════════════════════════════════════════════
    //  RENDER SCHEDULING (RAF batching)
    // ═══════════════════════════════════════════════

    _scheduleRender() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        requestAnimationFrame(() => {
            this._renderQueued = false;
            this.renderDashboard();
        });
    },

    // ═══════════════════════════════════════════════
    //  DASHBOARD RENDER
    // ═══════════════════════════════════════════════

    renderDashboard() {
        const s = this.data.settings;
        const t = this._computeTotals();
        const fmt = (num) => `₪${Number(num).toLocaleString('he-IL')}`;

        // ── Batch all DOM writes ──
        this.dom.namesDisplay.textContent = `${s.groom_name} & ${s.bride_name}`;
        this.dom.budgetTotal.textContent = fmt(s.total_budget);
        this.dom.budgetLeft.textContent = fmt(t.remaining);
        this.dom.budgetSpent.textContent = `הוצאנו ${fmt(t.totalSpent)} מתוך ${fmt(s.total_budget)}`;
        this.dom.totalGuests.textContent = t.totalGuests;
        this.dom.totalGifts.textContent = fmt(t.totalGifts);

        // Color coding
        this.dom.budgetLeft.style.color = t.remaining < 0 ? 'var(--danger)' : '#fff';

        // Progress bar — GPU accelerated via scaleX (no layout/reflow)
        const percent = s.total_budget > 0
            ? Math.min((t.totalSpent / s.total_budget), 1)
            : 0;
        this.dom.budgetProgress.style.transform = `scaleX(${percent})`;
        this.dom.budgetProgress.style.background = percent >= 1
            ? 'var(--danger)'
            : 'linear-gradient(90deg, var(--accent-gold), #fde68a)';
    },

    // ═══════════════════════════════════════════════
    //  COUNTDOWN — Optimized interval
    // ═══════════════════════════════════════════════

    startCountdown() {
        // Use a longer interval (every 30s) — no need for per-second when showing days
        const update = () => {
            const weddingDate = new Date(this.data.settings.wedding_date).getTime();
            const now = Date.now();
            const distance = weddingDate - now;

            if (distance < 0) {
                this.dom.dateDisplay.textContent = "מזל טוב! החתונה כבר עברה 🎉";
                return;
            }

            const days = Math.floor(distance / 86400000);
            const hours = Math.floor((distance % 86400000) / 3600000);
            const minutes = Math.floor((distance % 3600000) / 60000);

            this.dom.dateDisplay.textContent = `עוד ${days} ימים, ${hours}:${String(minutes).padStart(2, '0')} שעות`;
        };

        update();
        // 30 second interval instead of 1 second — saves ~29 DOM writes per 30s
        this._countdownInterval = setInterval(update, 30000);
    },

    // ═══════════════════════════════════════════════
    //  NAVIGATION
    // ═══════════════════════════════════════════════

    switchTab(tabId) {
        // Read all sections
        const sections = document.querySelectorAll('.app-section');
        const navItems = this.dom.bottomNav.querySelectorAll('.nav-item');

        // Batch writes
        sections.forEach(el => el.classList.remove('active'));
        navItems.forEach(el => {
            el.classList.remove('active');
            el.setAttribute('aria-selected', 'false');
        });

        const targetSection = document.getElementById(tabId);
        const targetNav = this.dom.bottomNav.querySelector(`[data-tab="${tabId}"]`);

        if (targetSection) targetSection.classList.add('active');
        if (targetNav) {
            targetNav.classList.add('active');
            targetNav.setAttribute('aria-selected', 'true');
        }

        // Lazy render lists only when their tab is activated
        if (tabId === 'expenses') this.renderExpenses();
        if (tabId === 'guests') this.renderGuests();
    },

    // ═══════════════════════════════════════════════
    //  EXPENSES — DocumentFragment rendering
    // ═══════════════════════════════════════════════

    renderExpenses() {
        const list = this.data.expenses;

        if (list.length === 0) {
            this.dom.expensesList.innerHTML = '<div class="empty-state">אין הוצאות עדיין. לחצו על + כדי להוסיף.</div>';
            return;
        }

        // Build in DocumentFragment — single DOM insertion
        const fragment = document.createDocumentFragment();

        for (let i = 0, len = list.length; i < len; i++) {
            const ex = list[i];
            const paid = Number(ex.paid_amount) || 0;
            const cost = Number(ex.estimated_cost) || 0;

            const item = document.createElement('div');
            item.className = 'list-item';
            item.setAttribute('role', 'listitem');
            item.innerHTML = `
                <div class="item-details">
                    <h4>${this._escapeHtml(ex.title)}</h4>
                    <p>שולם: ₪${paid.toLocaleString('he-IL')} / עלות: ₪${cost.toLocaleString('he-IL')}</p>
                </div>
                <div class="item-actions">
                    <span class="text-gold">₪${cost.toLocaleString('he-IL')}</span>
                    <button data-action="delete" data-index="${i}" aria-label="מחק ${this._escapeHtml(ex.title)}">
                        <i class="fas fa-trash-alt" aria-hidden="true"></i>
                    </button>
                </div>`;

            fragment.appendChild(item);
        }

        // Single DOM write
        this.dom.expensesList.innerHTML = '';
        this.dom.expensesList.appendChild(fragment);
    },

    openExpenseModal() {
        this.dom.modalTitle.textContent = "הוסף הוצאה חדשה";
        this.dom.modalBody.innerHTML = `
            <label class="modal-label" for="exTitle">שם הוצאה</label>
            <input class="app-input" id="exTitle" placeholder="שם ההוצאה" autocomplete="off">
            <label class="modal-label" for="exCost">עלות משוערת</label>
            <input class="app-input" id="exCost" type="number" inputmode="numeric" placeholder="עלות משוערת">
            <label class="modal-label" for="exPaid">סכום ששולם</label>
            <input class="app-input" id="exPaid" type="number" inputmode="numeric" placeholder="סכום ששולם">`;

        this.dom.modalActionBtn.onclick = () => {
            const title = document.getElementById('exTitle').value.trim();
            const cost = document.getElementById('exCost').value;
            const paid = document.getElementById('exPaid').value;

            if (!title || !cost) {
                this._shakeInput(!title ? 'exTitle' : 'exCost');
                return;
            }

            this.data.expenses.push({
                title,
                estimated_cost: Number(cost),
                paid_amount: Number(paid) || 0
            });

            this.saveData();
            this.closeModal();
            this.renderExpenses();
        };

        this.showModal();
        // Auto-focus first input after modal opens
        requestAnimationFrame(() => {
            document.getElementById('exTitle')?.focus();
        });
    },

    // ═══════════════════════════════════════════════
    //  GUESTS — DocumentFragment + filtered render
    // ═══════════════════════════════════════════════

    renderGuests(filterText = '') {
        const searchTerm = filterText.trim();
        const list = searchTerm
            ? this.data.guests.filter(g => g.name.includes(searchTerm))
            : this.data.guests;

        if (list.length === 0) {
            const msg = searchTerm
                ? 'לא נמצאו אורחים תואמים.'
                : 'אין אורחים ברשימה. לחצו על + כדי להוסיף.';
            this.dom.guestsList.innerHTML = `<div class="empty-state">${msg}</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        for (let i = 0, len = list.length; i < len; i++) {
            const g = list[i];
            // Find actual index in full array for deletion
            const realIndex = this.data.guests.indexOf(g);
            const giftNum = Number(g.gift) || 0;

            const item = document.createElement('div');
            item.className = 'list-item';
            item.setAttribute('role', 'listitem');
            item.innerHTML = `
                <div class="item-details">
                    <h4>${this._escapeHtml(g.name)} <small class="text-muted">${Number(g.total_people) || 1}</small></h4>
                    <p>${this._escapeHtml(g.side || '')} | ${this._escapeHtml(g.status || 'טרם אישר')}</p>
                </div>
                <div class="item-actions">
                    ${giftNum > 0 ? `<span class="text-success">+₪${giftNum.toLocaleString('he-IL')}</span>` : ''}
                    <button data-action="delete" data-index="${realIndex}" aria-label="מחק ${this._escapeHtml(g.name)}">
                        <i class="fas fa-trash-alt" aria-hidden="true"></i>
                    </button>
                </div>`;

            fragment.appendChild(item);
        }

        this.dom.guestsList.innerHTML = '';
        this.dom.guestsList.appendChild(fragment);
    },

    openGuestModal() {
        this.dom.modalTitle.textContent = "הוסף אורח";
        this.dom.modalBody.innerHTML = `
            <label class="modal-label" for="gName">שם האורח</label>
            <input class="app-input" id="gName" placeholder="שם מלא" autocomplete="off">
            <label class="modal-label" for="gSide">צד</label>
            <select class="app-input" id="gSide">
                <option value="צד חתן">צד חתן</option>
                <option value="צד כלה">צד כלה</option>
            </select>
            <label class="modal-label" for="gCount">מספר אנשים</label>
            <input class="app-input" id="gCount" type="number" inputmode="numeric" value="1" min="1">
            <label class="modal-label" for="gStatus">סטטוס</label>
            <select class="app-input" id="gStatus">
                <option value="טרם אישר">טרם אישר</option>
                <option value="מגיע">מגיע</option>
                <option value="לא מגיע">לא מגיע</option>
            </select>
            <label class="modal-label" for="gGift">סכום מתנה</label>
            <input class="app-input" id="gGift" type="number" inputmode="numeric" placeholder="סכום מתנה">`;

        this.dom.modalActionBtn.onclick = () => {
            const name = document.getElementById('gName').value.trim();
            if (!name) {
                this._shakeInput('gName');
                return;
            }

            this.data.guests.push({
                name,
                side: document.getElementById('gSide').value,
                total_people: Number(document.getElementById('gCount').value) || 1,
                status: document.getElementById('gStatus').value,
                gift: Number(document.getElementById('gGift').value) || 0
            });

            this.saveData();
            this.closeModal();
            this.renderGuests();
        };

        this.showModal();
        requestAnimationFrame(() => {
            document.getElementById('gName')?.focus();
        });
    },

    // ═══════════════════════════════════════════════
    //  SETTINGS
    // ═══════════════════════════════════════════════

    openSettingsModal() {
        const s = this.data.settings;
        this.dom.modalTitle.textContent = "הגדרות חתונה";
        this.dom.modalBody.innerHTML = `
            <label class="modal-label" for="sBudget">תקציב כולל</label>
            <input class="app-input" id="sBudget" type="number" inputmode="numeric" value="${s.total_budget}">
            <label class="modal-label" for="sGroom">שם חתן</label>
            <input class="app-input" id="sGroom" value="${this._escapeHtml(s.groom_name)}">
            <label class="modal-label" for="sBride">שם כלה</label>
            <input class="app-input" id="sBride" value="${this._escapeHtml(s.bride_name)}">
            <label class="modal-label" for="sDate">תאריך חתונה</label>
            <input class="app-input" id="sDate" type="date" value="${s.wedding_date}">`;

        this.dom.modalActionBtn.onclick = () => {
            this.data.settings.total_budget = Number(document.getElementById('sBudget').value) || 0;
            this.data.settings.groom_name = document.getElementById('sGroom').value.trim() || "החתן";
            this.data.settings.bride_name = document.getElementById('sBride').value.trim() || "הכלה";
            this.data.settings.wedding_date = document.getElementById('sDate').value;
            this.saveData();
            this.closeModal();
            // Restart countdown with new date
            clearInterval(this._countdownInterval);
            this.startCountdown();
        };

        this.showModal();
    },

    // ═══════════════════════════════════════════════
    //  SHARED METHODS
    // ═══════════════════════════════════════════════

    deleteItem(type, index) {
        if (!confirm('למחוק פריט זה?')) return;

        this.data[type].splice(index, 1);
        this.saveData();

        if (type === 'expenses') this.renderExpenses();
        if (type === 'guests') this.renderGuests(this.dom.guestSearch.value);
    },

    showModal() {
        // Prevent background scroll
        document.body.style.overflow = 'hidden';
        this.dom.modal.style.display = 'flex';
        // Force reflow before adding class (ensures transition plays)
        this.dom.modal.offsetHeight; // eslint-disable-line no-unused-expressions
        this.dom.modal.classList.add('show');
        // Trap focus inside modal
        this.dom.modal.setAttribute('aria-hidden', 'false');
    },

    closeModal() {
        this.dom.modal.classList.remove('show');
        this.dom.modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';

        // Wait for transition before hiding
        setTimeout(() => {
            this.dom.modal.style.display = 'none';
            // Cleanup onclick to prevent memory leaks
            this.dom.modalActionBtn.onclick = null;
        }, 250);
    },

    // ═══════════════════════════════════════════════
    //  UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════

    /** Debounce — prevents excessive function calls */
    _debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    /** XSS-safe HTML escaping */
    _escapeHtml(str) {
        if (!str) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, (c) => map[c]);
    },

    /** Visual feedback for validation errors */
    _shakeInput(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.style.borderColor = 'var(--danger)';
        el.style.transition = 'border-color 0.3s';
        el.focus();
        setTimeout(() => {
            el.style.borderColor = '';
        }, 2000);
    }
};

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => {
    WeddingApp.init();
});