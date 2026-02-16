/**
 * CHATAN — Premium Wedding Planner Engine
 * ═══════════════════════════════════════════
 * Architecture:
 *   DataLayer    → localStorage CRUD + auto-save
 *   ComputeLayer → cached aggregations
 *   UILayer      → DocumentFragment rendering + RAF batching
 *   EventLayer   → delegation + debounce
 *
 * Author: Elad
 */

const App = {
    DB: 'chatan_v3',
    _dirty: false,

    // ═══ DEFAULT DATA ═══
    defaults: {
        onboarded: false,
        settings: {
            groom: 'החתן',
            bride: 'הכלה',
            date: '',
            budget: 150000,
            guest_estimate: 300,
        },
        expenses: [],
        guests: [],
        tasks: [],
    },

    data: null,
    dom: {},
    _cache: null,
    _countdownTimer: null,
    _activeExpFilter: 'all',
    _activeGuestFilter: 'all',
    _guestSearchText: '',

    // ═══════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════
    init() {
        this.load();
        this.cacheDom();
        this.bind();

        if (!this.data.onboarded) {
            this.showOnboarding();
        } else {
            this.showApp();
        }
    },

    // ═══════════════════════════════════════
    //  DATA LAYER
    // ═══════════════════════════════════════
    load() {
        try {
            const raw = localStorage.getItem(this.DB);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.data = {
                    ...this.defaults,
                    ...parsed,
                    settings: { ...this.defaults.settings, ...parsed.settings },
                };
            } else {
                this.data = JSON.parse(JSON.stringify(this.defaults));
            }
        } catch (e) {
            console.error('Load error:', e);
            this.data = JSON.parse(JSON.stringify(this.defaults));
        }
    },

    save() {
        try {
            localStorage.setItem(this.DB, JSON.stringify(this.data));
        } catch (e) {
            console.error('Save error:', e);
            this.toast('שגיאה בשמירה', 'error');
        }
        this._cache = null;
        this.scheduleRender();
    },

    // ═══════════════════════════════════════
    //  DOM CACHE
    // ═══════════════════════════════════════
    cacheDom() {
        const q = (id) => document.getElementById(id);
        this.dom = {
            onboarding: q('onboarding'),
            app: q('appShell'),
            // Header
            headerNames: q('headerNames'),
            countdownText: q('countdownText'),
            wpFill: q('wpFill'),
            wpLabel: q('wpLabel'),
            // Dashboard
            dBudgetLeft: q('dBudgetLeft'),
            dBudgetBar: q('dBudgetBar'),
            dBudgetSpent: q('dBudgetSpent'),
            dBudgetTotal: q('dBudgetTotal'),
            budgetAlert: q('budgetAlert'),
            budgetAlertText: q('budgetAlertText'),
            dGuests: q('dGuests'),
            dConfirmed: q('dConfirmed'),
            dGifts: q('dGifts'),
            dashTasks: q('dashTasks'),
            dashExpenses: q('dashExpenses'),
            // Expenses
            eTotalCost: q('eTotalCost'),
            eTotalPaid: q('eTotalPaid'),
            eRemaining: q('eRemaining'),
            expList: q('expList'),
            expEmpty: q('expEmpty'),
            expChipBar: q('expChipBar'),
            // Guests
            gTotal: q('gTotal'),
            gOk: q('gOk'),
            gWait: q('gWait'),
            gNo: q('gNo'),
            guestList: q('guestList'),
            guestEmpty: q('guestEmpty'),
            guestSearch: q('guestSearch'),
            guestChipBar: q('guestChipBar'),
            // Tasks
            taskList: q('taskList'),
            taskEmpty: q('taskEmpty'),
            tpbFill: q('tpbFill'),
            tpbText: q('tpbText'),
            // Modal
            modal: q('modal'),
            modalTitle: q('modalTitle'),
            modalBody: q('modalBody'),
            modalSave: q('modalSave'),
            modalX: q('modalX'),
            // Toast
            toasts: q('toasts'),
            // Nav
            nav: document.querySelector('.bottom-nav'),
        };
    },

    // ═══════════════════════════════════════
    //  EVENT BINDING
    // ═══════════════════════════════════════
    bind() {
        // ─── Onboarding ───
        const obClick = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn.bind(this));
        };
        obClick('obNext1', () => this.obStep(2));
        obClick('obNext2', () => this.obStep(3));
        obClick('obBack2', () => this.obStep(1));
        obClick('obBack3', () => this.obStep(2));
        obClick('obFinish', () => this.finishOnboarding());

        // ─── Navigation (delegated) ───
        this.dom.nav.addEventListener('click', (e) => {
            const tab = e.target.closest('.nav-tab');
            if (tab) this.switchPage(tab.dataset.tab);
        });

        // ─── Stat chips → navigate ───
        document.querySelectorAll('[data-go]').forEach(el => {
            el.addEventListener('click', () => this.switchPage(el.dataset.go));
        });

        // ─── Dashboard buttons ───
        const btnBind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn.bind(this));
        };
        btnBind('btnSettings', () => this.openSettings());
        btnBind('btnAddExp', () => this.openExpenseModal());
        btnBind('btnAddGuest', () => this.openGuestModal());
        btnBind('btnAddTask', () => this.openTaskModal());
        btnBind('btnAddTaskDash', () => this.openTaskModal());
        btnBind('btnAddTaskFab', () => this.openTaskModal());
        btnBind('expEmptyBtn', () => this.openExpenseModal());
        btnBind('guestEmptyBtn', () => this.openGuestModal());
        btnBind('taskEmptyBtn', () => this.openTaskModal());

        // ─── Modal ───
        this.dom.modalX.addEventListener('click', () => this.closeModal());
        this.dom.modal.addEventListener('click', (e) => {
            if (e.target === this.dom.modal) this.closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.dom.modal.classList.contains('show')) this.closeModal();
        });

        // ─── Guest search (debounced) ───
        this.dom.guestSearch.addEventListener('input', this.debounce((e) => {
            this._guestSearchText = e.target.value.trim();
            this.renderGuests();
        }, 250));

        // ─── Expense filter chips (delegated) ───
        this.dom.expChipBar.addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (!chip) return;
            this.dom.expChipBar.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            this._activeExpFilter = chip.dataset.cat;
            this.renderExpenses();
        });

        // ─── Guest filter chips (delegated) ───
        this.dom.guestChipBar.addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (!chip) return;
            this.dom.guestChipBar.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            this._activeGuestFilter = chip.dataset.gf;
            this.renderGuests();
        });

        // ─── List delegated clicks ───
        this.dom.expList.addEventListener('click', (e) => {
            const del = e.target.closest('[data-del-exp]');
            if (del) this.deleteExpense(+del.dataset.delExp);
        });
        this.dom.guestList.addEventListener('click', (e) => {
            const del = e.target.closest('[data-del-guest]');
            if (del) this.deleteGuest(+del.dataset.delGuest);
        });
        this.dom.taskList.addEventListener('click', (e) => {
            const chk = e.target.closest('[data-toggle-task]');
            if (chk) { this.toggleTask(+chk.dataset.toggleTask); return; }
            const del = e.target.closest('[data-del-task]');
            if (del) this.deleteTask(+del.dataset.delTask);
        });
        // Dashboard task toggle
        this.dom.dashTasks.addEventListener('click', (e) => {
            const chk = e.target.closest('[data-toggle-task]');
            if (chk) this.toggleTask(+chk.dataset.toggleTask);
        });
    },

    // ═══════════════════════════════════════
    //  ONBOARDING
    // ═══════════════════════════════════════
    showOnboarding() {
        this.dom.onboarding.style.display = 'flex';
        this.dom.app.style.display = 'none';
        // Set default date to 6 months from now
        const future = new Date();
        future.setMonth(future.getMonth() + 6);
        const dateInput = document.getElementById('obDate');
        if (dateInput && !dateInput.value) {
            dateInput.value = future.toISOString().split('T')[0];
        }
    },

    obStep(step) {
        // Validate current step
        if (step === 2) {
            const g = document.getElementById('obGroom').value.trim();
            const b = document.getElementById('obBride').value.trim();
            if (!g && !b) {
                this.shakeEl('obGroom');
                return;
            }
        }

        document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
        document.getElementById(`obStep${step}`).classList.add('active');
        document.querySelectorAll('.step-dot').forEach((d, i) => {
            d.classList.remove('active', 'done');
            if (i + 1 < step) d.classList.add('done');
            if (i + 1 === step) d.classList.add('active');
        });
    },

    finishOnboarding() {
        const s = this.data.settings;
        s.groom = document.getElementById('obGroom').value.trim() || 'החתן';
        s.bride = document.getElementById('obBride').value.trim() || 'הכלה';
        s.date = document.getElementById('obDate').value;
        s.budget = Number(document.getElementById('obBudget').value) || 150000;
        s.guest_estimate = Number(document.getElementById('obGuests').value) || 300;
        this.data.onboarded = true;

        // Generate default tasks
        this.generateDefaultTasks();

        this.save();
        this.dom.onboarding.style.display = 'none';
        this.showApp();
        this.toast('מזל טוב! האפליקציה מוכנה 🎉', 'success');
    },

    generateDefaultTasks() {
        const defaultTasks = [
            { title: 'הזמנת אולם', category: 'אולם', done: false },
            { title: 'בחירת צלם ווידאו', category: 'צילום', done: false },
            { title: 'הזמנת DJ / להקה', category: 'מוזיקה', done: false },
            { title: 'בחירת שמלה / חליפה', category: 'לבוש', done: false },
            { title: 'שליחת הזמנות', category: 'הזמנות', done: false },
            { title: 'טעימות קייטרינג', category: 'קייטרינג', done: false },
            { title: 'הזמנת רב / עורך טקס', category: 'טקס', done: false },
            { title: 'סידורי רבנות', category: 'טקס', done: false },
            { title: 'בחירת עיצוב ופרחים', category: 'עיצוב', done: false },
            { title: 'הסעות לאורחים', category: 'לוגיסטיקה', done: false },
        ];
        this.data.tasks = defaultTasks.map((t, i) => ({
            id: Date.now() + i,
            ...t,
            created: new Date().toISOString(),
        }));
    },

    // ═══════════════════════════════════════
    //  APP DISPLAY
    // ═══════════════════════════════════════
    showApp() {
        this.dom.app.style.display = 'block';
        this.renderAll();
        this.startCountdown();
    },

    // ═══════════════════════════════════════
    //  COMPUTE (cached)
    // ═══════════════════════════════════════
    compute() {
        if (this._cache) return this._cache;
        const exp = this.data.expenses;
        const gst = this.data.guests;
        const tsk = this.data.tasks;

        let totalCost = 0, totalPaid = 0, totalGuests = 0, confirmed = 0, pending = 0, declined = 0, gifts = 0;

        for (let i = 0; i < exp.length; i++) {
            totalCost += Number(exp[i].cost) || 0;
            totalPaid += Number(exp[i].paid) || 0;
        }
        for (let i = 0; i < gst.length; i++) {
            const cnt = Number(gst[i].count) || 1;
            totalGuests += cnt;
            gifts += Number(gst[i].gift) || 0;
            if (gst[i].status === 'מגיע') confirmed += cnt;
            else if (gst[i].status === 'לא מגיע') declined += cnt;
            else pending += cnt;
        }

        const doneTasks = tsk.filter(t => t.done).length;
        const totalTasks = tsk.length;

        // Wedding progress (tasks + has budget + has guests)
        let progressItems = 0, progressDone = 0;
        progressItems = totalTasks + 2; // +2 for budget setup & guests
        progressDone = doneTasks;
        if (exp.length > 0) progressDone++;
        if (gst.length > 0) progressDone++;
        const weddingProgress = progressItems > 0 ? Math.round((progressDone / progressItems) * 100) : 0;

        this._cache = {
            totalCost, totalPaid,
            expRemaining: totalCost - totalPaid,
            budgetLeft: this.data.settings.budget - totalPaid,
            budgetPercent: this.data.settings.budget > 0 ? Math.min(totalPaid / this.data.settings.budget, 1) : 0,
            totalGuests, confirmed, pending, declined, gifts,
            doneTasks, totalTasks,
            taskPercent: totalTasks > 0 ? doneTasks / totalTasks : 0,
            weddingProgress: Math.min(weddingProgress, 100),
        };
        return this._cache;
    },

    // ═══════════════════════════════════════
    //  RENDER SCHEDULING
    // ═══════════════════════════════════════
    _raf: false,
    scheduleRender() {
        if (this._raf) return;
        this._raf = true;
        requestAnimationFrame(() => {
            this._raf = false;
            this.renderAll();
        });
    },

    renderAll() {
        this.renderHeader();
        this.renderDashboard();
        this.renderExpenses();
        this.renderGuests();
        this.renderTasks();
    },

    // ═══════════════════════════════════════
    //  RENDER: HEADER
    // ═══════════════════════════════════════
    renderHeader() {
        const s = this.data.settings;
        const c = this.compute();
        this.dom.headerNames.textContent = `${s.groom} & ${s.bride}`;
        this.dom.wpFill.style.transform = `scaleX(${c.weddingProgress / 100})`;
        this.dom.wpLabel.textContent = `${c.weddingProgress}% הושלם`;
    },

    startCountdown() {
        if (this._countdownTimer) clearInterval(this._countdownTimer);
        const update = () => {
            const d = this.data.settings.date;
            if (!d) { this.dom.countdownText.textContent = 'לא נקבע תאריך'; return; }
            const diff = new Date(d).getTime() - Date.now();
            if (diff < 0) { this.dom.countdownText.textContent = 'מזל טוב! 🎉'; return; }
            const days = Math.floor(diff / 86400000);
            const hrs = Math.floor((diff % 86400000) / 3600000);
            this.dom.countdownText.textContent = `עוד ${days} ימים ו-${hrs} שעות`;
        };
        update();
        this._countdownTimer = setInterval(update, 60000);
    },

    // ═══════════════════════════════════════
    //  RENDER: DASHBOARD
    // ═══════════════════════════════════════
    renderDashboard() {
        const s = this.data.settings;
        const c = this.compute();
        const fmt = (n) => `₪${Number(n).toLocaleString('he-IL')}`;

        // Budget card
        this.dom.dBudgetLeft.textContent = fmt(c.budgetLeft);
        this.dom.dBudgetLeft.style.color = c.budgetLeft < 0 ? 'var(--danger)' : '';
        this.dom.dBudgetBar.style.transform = `scaleX(${c.budgetPercent})`;
        this.dom.dBudgetBar.style.background = c.budgetPercent >= 1
            ? 'var(--danger)'
            : 'linear-gradient(90deg, var(--gold), var(--gold-light))';
        this.dom.dBudgetSpent.textContent = `${fmt(c.totalPaid)} הוצאנו`;
        this.dom.dBudgetTotal.textContent = `מתוך ${fmt(s.budget)}`;

        // Budget alert
        if (c.budgetPercent >= 1) {
            this.dom.budgetAlert.style.display = 'flex';
            this.dom.budgetAlert.className = 'cb-alert danger';
            this.dom.budgetAlertText.textContent = `חריגה מהתקציב ב-${fmt(Math.abs(c.budgetLeft))}!`;
        } else if (c.budgetPercent >= 0.85) {
            this.dom.budgetAlert.style.display = 'flex';
            this.dom.budgetAlert.className = 'cb-alert warn';
            this.dom.budgetAlertText.textContent = `נותרו רק ${fmt(c.budgetLeft)} — שימו לב לתקציב`;
        } else {
            this.dom.budgetAlert.style.display = 'none';
        }

        // Stats
        this.dom.dGuests.textContent = c.totalGuests;
        this.dom.dConfirmed.textContent = c.confirmed;
        this.dom.dGifts.textContent = fmt(c.gifts);

        // Dashboard tasks (top 5 incomplete)
        const upcomingTasks = this.data.tasks.filter(t => !t.done).slice(0, 5);
        if (upcomingTasks.length === 0) {
            this.dom.dashTasks.innerHTML = '<div class="empty-mini">אין משימות פתוחות 👏</div>';
        } else {
            this.dom.dashTasks.innerHTML = upcomingTasks.map(t => `
                <div class="dash-task-item">
                    <button class="task-check ${t.done ? 'checked' : ''}" data-toggle-task="${this.data.tasks.indexOf(t)}">
                        ${t.done ? '<i class="fas fa-check"></i>' : ''}
                    </button>
                    <span class="dash-task-title">${this.esc(t.title)}</span>
                </div>
            `).join('');
        }

        // Dashboard recent expenses (last 3)
        const recent = [...this.data.expenses].reverse().slice(0, 3);
        if (recent.length === 0) {
            this.dom.dashExpenses.innerHTML = '<div class="empty-mini">הוסיפו הוצאה ראשונה</div>';
        } else {
            this.dom.dashExpenses.innerHTML = recent.map(ex => `
                <div class="list-item">
                    <div class="li-icon expense"><i class="fas fa-receipt"></i></div>
                    <div class="li-body">
                        <div class="li-title">${this.esc(ex.title)}</div>
                        <div class="li-sub">${this.esc(ex.category || 'כללי')}</div>
                    </div>
                    <div class="li-end">
                        <span class="li-amount gold">${fmt(ex.cost)}</span>
                    </div>
                </div>
            `).join('');
        }
    },

    // ═══════════════════════════════════════
    //  RENDER: EXPENSES
    // ═══════════════════════════════════════
    renderExpenses() {
        const c = this.compute();
        const fmt = (n) => `₪${Number(n).toLocaleString('he-IL')}`;

        this.dom.eTotalCost.textContent = fmt(c.totalCost);
        this.dom.eTotalPaid.textContent = fmt(c.totalPaid);
        this.dom.eRemaining.textContent = fmt(c.expRemaining);

        let list = this.data.expenses;
        if (this._activeExpFilter !== 'all') {
            list = list.filter(ex => ex.category === this._activeExpFilter);
        }

        if (list.length === 0) {
            this.dom.expList.innerHTML = '';
            this.dom.expEmpty.style.display = this.data.expenses.length === 0 ? 'block' : 'block';
            return;
        }
        this.dom.expEmpty.style.display = 'none';

        const frag = document.createDocumentFragment();
        list.forEach((ex) => {
            const realIdx = this.data.expenses.indexOf(ex);
            const paid = Number(ex.paid) || 0;
            const cost = Number(ex.cost) || 0;
            const paidPercent = cost > 0 ? Math.round((paid / cost) * 100) : 0;

            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="li-icon expense"><i class="fas fa-receipt"></i></div>
                <div class="li-body">
                    <div class="li-title">${this.esc(ex.title)}</div>
                    <div class="li-sub">${this.esc(ex.category || 'כללי')} · שולם ${paidPercent}%</div>
                </div>
                <div class="li-end">
                    <span class="li-amount gold">${fmt(cost)}</span>
                    <button class="li-delete" data-del-exp="${realIdx}" aria-label="מחק">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>`;
            frag.appendChild(div);
        });
        this.dom.expList.innerHTML = '';
        this.dom.expList.appendChild(frag);
    },

    openExpenseModal() {
        this.dom.modalTitle.textContent = 'הוסף הוצאה';
        this.dom.modalBody.innerHTML = `
            <div class="field-group">
                <label>שם ההוצאה / ספק</label>
                <input class="premium-input" id="mExpTitle" placeholder="לדוגמה: אולם הגן" autocomplete="off">
            </div>
            <div class="field-group">
                <label>קטגוריה</label>
                <select class="premium-input" id="mExpCat">
                    <option value="אולם">🏛 אולם</option>
                    <option value="קייטרינג">🍽 קייטרינג</option>
                    <option value="צילום">📷 צילום</option>
                    <option value="מוזיקה">🎵 מוזיקה</option>
                    <option value="לבוש">👗 לבוש</option>
                    <option value="הזמנות">💌 הזמנות</option>
                    <option value="עיצוב">🌸 עיצוב</option>
                    <option value="אחר">📦 אחר</option>
                </select>
            </div>
            <div class="field-row">
                <div class="field-group">
                    <label>עלות כוללת (₪)</label>
                    <input class="premium-input" id="mExpCost" type="number" inputmode="numeric" placeholder="0">
                </div>
                <div class="field-group">
                    <label>שולם (₪)</label>
                    <input class="premium-input" id="mExpPaid" type="number" inputmode="numeric" placeholder="0">
                </div>
            </div>
            <div class="field-group">
                <label>הערות (אופציונלי)</label>
                <input class="premium-input" id="mExpNote" placeholder="פרטים נוספים...">
            </div>`;

        this.dom.modalSave.onclick = () => {
            const title = document.getElementById('mExpTitle').value.trim();
            const cost = document.getElementById('mExpCost').value;
            if (!title) { this.shakeEl('mExpTitle'); return; }
            if (!cost) { this.shakeEl('mExpCost'); return; }

            this.data.expenses.push({
                id: Date.now(),
                title,
                category: document.getElementById('mExpCat').value,
                cost: Number(cost) || 0,
                paid: Number(document.getElementById('mExpPaid').value) || 0,
                note: document.getElementById('mExpNote').value.trim(),
                created: new Date().toISOString(),
            });
            this.save();
            this.closeModal();
            this.toast('הוצאה נוספה בהצלחה ✓', 'success');
        };
        this.showModal();
        requestAnimationFrame(() => document.getElementById('mExpTitle')?.focus());
    },

    deleteExpense(idx) {
        if (!confirm('למחוק הוצאה זו?')) return;
        this.data.expenses.splice(idx, 1);
        this.save();
        this.toast('ההוצאה נמחקה', 'info');
    },

    // ═══════════════════════════════════════
    //  RENDER: GUESTS
    // ═══════════════════════════════════════
    renderGuests() {
        const c = this.compute();
        this.dom.gTotal.textContent = c.totalGuests;
        this.dom.gOk.textContent = c.confirmed;
        this.dom.gWait.textContent = c.pending;
        this.dom.gNo.textContent = c.declined;

        let list = this.data.guests;
        if (this._activeGuestFilter !== 'all') {
            list = list.filter(g => g.status === this._activeGuestFilter);
        }
        if (this._guestSearchText) {
            list = list.filter(g => g.name.includes(this._guestSearchText));
        }

        if (list.length === 0) {
            this.dom.guestList.innerHTML = '';
            this.dom.guestEmpty.style.display = this.data.guests.length === 0 ? 'block' : 'block';
            if (this.data.guests.length > 0 && list.length === 0) {
                this.dom.guestEmpty.querySelector('h3').textContent = 'לא נמצאו תוצאות';
                this.dom.guestEmpty.querySelector('p').textContent = 'נסו חיפוש אחר או שנו סינון';
                this.dom.guestEmpty.querySelector('button').style.display = 'none';
            }
            return;
        }
        this.dom.guestEmpty.style.display = 'none';
        // Reset empty state text
        const emptyH3 = this.dom.guestEmpty.querySelector('h3');
        if (emptyH3) emptyH3.textContent = 'הרשימה ריקה';

        const badgeClass = (s) => s === 'מגיע' ? 'ok' : s === 'לא מגיע' ? 'no' : 'wait';
        const badgeText = (s) => s === 'מגיע' ? 'מגיע' : s === 'לא מגיע' ? 'לא מגיע' : 'ממתין';
        const fmt = (n) => `₪${Number(n).toLocaleString('he-IL')}`;

        const frag = document.createDocumentFragment();
        list.forEach(g => {
            const realIdx = this.data.guests.indexOf(g);
            const giftNum = Number(g.gift) || 0;
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="li-icon guest"><i class="fas fa-user"></i></div>
                <div class="li-body">
                    <div class="li-title">${this.esc(g.name)} <small style="color:var(--text-dim);font-weight:400;">(${Number(g.count) || 1})</small></div>
                    <div class="li-sub">${this.esc(g.side || '')}</div>
                </div>
                <div class="li-end">
                    ${giftNum > 0 ? `<span class="li-amount success">+${fmt(giftNum)}</span>` : ''}
                    <span class="li-badge ${badgeClass(g.status)}">${badgeText(g.status)}</span>
                    <button class="li-delete" data-del-guest="${realIdx}" aria-label="מחק">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>`;
            frag.appendChild(div);
        });
        this.dom.guestList.innerHTML = '';
        this.dom.guestList.appendChild(frag);
    },

    openGuestModal() {
        this.dom.modalTitle.textContent = 'הוסף אורח';
        this.dom.modalBody.innerHTML = `
            <div class="field-group">
                <label>שם מלא</label>
                <input class="premium-input" id="mGName" placeholder="שם האורח/ת" autocomplete="off">
            </div>
            <div class="field-row">
                <div class="field-group">
                    <label>צד</label>
                    <select class="premium-input" id="mGSide">
                        <option value="צד חתן">צד חתן</option>
                        <option value="צד כלה">צד כלה</option>
                        <option value="משותף">משותף</option>
                    </select>
                </div>
                <div class="field-group">
                    <label>מס׳ אנשים</label>
                    <input class="premium-input" id="mGCount" type="number" inputmode="numeric" value="1" min="1">
                </div>
            </div>
            <div class="field-row">
                <div class="field-group">
                    <label>סטטוס</label>
                    <select class="premium-input" id="mGStatus">
                        <option value="טרם אישר">טרם אישר</option>
                        <option value="מגיע">מגיע ✓</option>
                        <option value="לא מגיע">לא מגיע ✗</option>
                    </select>
                </div>
                <div class="field-group">
                    <label>מתנה (₪)</label>
                    <input class="premium-input" id="mGGift" type="number" inputmode="numeric" placeholder="0">
                </div>
            </div>`;

        this.dom.modalSave.onclick = () => {
            const name = document.getElementById('mGName').value.trim();
            if (!name) { this.shakeEl('mGName'); return; }
            this.data.guests.push({
                id: Date.now(),
                name,
                side: document.getElementById('mGSide').value,
                count: Number(document.getElementById('mGCount').value) || 1,
                status: document.getElementById('mGStatus').value,
                gift: Number(document.getElementById('mGGift').value) || 0,
                created: new Date().toISOString(),
            });
            this.save();
            this.closeModal();
            this.toast(`${name} נוסף/ה לרשימה ✓`, 'success');
        };
        this.showModal();
        requestAnimationFrame(() => document.getElementById('mGName')?.focus());
    },

    deleteGuest(idx) {
        if (!confirm('למחוק אורח זה?')) return;
        this.data.guests.splice(idx, 1);
        this.save();
        this.toast('האורח הוסר', 'info');
    },

    // ═══════════════════════════════════════
    //  RENDER: TASKS
    // ═══════════════════════════════════════
    renderTasks() {
        const c = this.compute();
        this.dom.tpbFill.style.transform = `scaleX(${c.taskPercent})`;
        this.dom.tpbText.textContent = `${c.doneTasks} מתוך ${c.totalTasks} הושלמו`;

        const list = this.data.tasks;
        if (list.length === 0) {
            this.dom.taskList.innerHTML = '';
            this.dom.taskEmpty.style.display = 'block';
            return;
        }
        this.dom.taskEmpty.style.display = 'none';

        // Sort: incomplete first, then done
        const sorted = [...list].sort((a, b) => a.done - b.done);

        const frag = document.createDocumentFragment();
        sorted.forEach(t => {
            const idx = this.data.tasks.indexOf(t);
            const div = document.createElement('div');
            div.className = `list-item ${t.done ? 'task-done' : ''}`;
            div.innerHTML = `
                <button class="task-check ${t.done ? 'checked' : ''}" data-toggle-task="${idx}" aria-label="${t.done ? 'סמן כלא הושלם' : 'סמן כהושלם'}">
                    ${t.done ? '<i class="fas fa-check"></i>' : ''}
                </button>
                <div class="li-body">
                    <div class="li-title">${this.esc(t.title)}</div>
                    <div class="li-sub">${this.esc(t.category || '')}</div>
                </div>
                <div class="li-end">
                    <button class="li-delete" data-del-task="${idx}" aria-label="מחק">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>`;
            frag.appendChild(div);
        });
        this.dom.taskList.innerHTML = '';
        this.dom.taskList.appendChild(frag);
    },

    openTaskModal() {
        this.dom.modalTitle.textContent = 'הוסף משימה';
        this.dom.modalBody.innerHTML = `
            <div class="field-group">
                <label>תיאור המשימה</label>
                <input class="premium-input" id="mTaskTitle" placeholder="לדוגמה: לבחור צלם" autocomplete="off">
            </div>
            <div class="field-group">
                <label>קטגוריה (אופציונלי)</label>
                <input class="premium-input" id="mTaskCat" placeholder="אולם, צילום, מוזיקה...">
            </div>`;

        this.dom.modalSave.onclick = () => {
            const title = document.getElementById('mTaskTitle').value.trim();
            if (!title) { this.shakeEl('mTaskTitle'); return; }
            this.data.tasks.push({
                id: Date.now(),
                title,
                category: document.getElementById('mTaskCat').value.trim(),
                done: false,
                created: new Date().toISOString(),
            });
            this.save();
            this.closeModal();
            this.toast('משימה נוספה ✓', 'success');
        };
        this.showModal();
        requestAnimationFrame(() => document.getElementById('mTaskTitle')?.focus());
    },

    toggleTask(idx) {
        if (idx < 0 || idx >= this.data.tasks.length) return;
        this.data.tasks[idx].done = !this.data.tasks[idx].done;
        this.save();
        if (this.data.tasks[idx].done) {
            this.toast('משימה הושלמה 🎉', 'success');
        }
    },

    deleteTask(idx) {
        if (!confirm('למחוק משימה זו?')) return;
        this.data.tasks.splice(idx, 1);
        this.save();
        this.toast('המשימה נמחקה', 'info');
    },

    // ═══════════════════════════════════════
    //  SETTINGS
    // ═══════════════════════════════════════
    openSettings() {
        const s = this.data.settings;
        this.dom.modalTitle.textContent = 'הגדרות';
        this.dom.modalBody.innerHTML = `
            <div class="field-row">
                <div class="field-group">
                    <label>שם חתן</label>
                    <input class="premium-input" id="mSGroom" value="${this.esc(s.groom)}">
                </div>
                <div class="field-group">
                    <label>שם כלה</label>
                    <input class="premium-input" id="mSBride" value="${this.esc(s.bride)}">
                </div>
            </div>
            <div class="field-group">
                <label>תאריך חתונה</label>
                <input class="premium-input" id="mSDate" type="date" value="${s.date}">
            </div>
            <div class="field-group">
                <label>תקציב כולל (₪)</label>
                <input class="premium-input" id="mSBudget" type="number" inputmode="numeric" value="${s.budget}">
            </div>
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
                <button class="btn-ghost" id="mSReset" style="color:var(--danger);font-size:0.85rem;">
                    <i class="fas fa-exclamation-triangle"></i> אפס את כל הנתונים
                </button>
            </div>`;

        // Reset handler
        setTimeout(() => {
            document.getElementById('mSReset')?.addEventListener('click', () => {
                if (confirm('פעולה זו תמחק את כל הנתונים. להמשיך?')) {
                    localStorage.removeItem(this.DB);
                    location.reload();
                }
            });
        }, 50);

        this.dom.modalSave.onclick = () => {
            s.groom = document.getElementById('mSGroom').value.trim() || 'החתן';
            s.bride = document.getElementById('mSBride').value.trim() || 'הכלה';
            s.date = document.getElementById('mSDate').value;
            s.budget = Number(document.getElementById('mSBudget').value) || 0;
            this.save();
            this.closeModal();
            clearInterval(this._countdownTimer);
            this.startCountdown();
            this.toast('ההגדרות עודכנו ✓', 'success');
        };
        this.showModal();
    },

    // ═══════════════════════════════════════
    //  NAVIGATION
    // ═══════════════════════════════════════
    switchPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });

        const page = document.getElementById(pageId);
        const tab = this.dom.nav.querySelector(`[data-tab="${pageId}"]`);
        if (page) page.classList.add('active');
        if (tab) { tab.classList.add('active'); tab.setAttribute('aria-selected', 'true'); }

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'instant' });
    },

    // ═══════════════════════════════════════
    //  MODAL
    // ═══════════════════════════════════════
    showModal() {
        document.body.style.overflow = 'hidden';
        this.dom.modal.style.display = 'flex';
        this.dom.modal.offsetHeight;
        this.dom.modal.classList.add('show');
    },

    closeModal() {
        this.dom.modal.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(() => {
            this.dom.modal.style.display = 'none';
            this.dom.modalSave.onclick = null;
        }, 250);
    },

    // ═══════════════════════════════════════
    //  TOAST
    // ═══════════════════════════════════════
    toast(msg, type = 'info') {
        const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${this.esc(msg)}`;
        this.dom.toasts.appendChild(el);
        setTimeout(() => {
            el.classList.add('removing');
            setTimeout(() => el.remove(), 300);
        }, 2800);
    },

    // ═══════════════════════════════════════
    //  UTILITIES
    // ═══════════════════════════════════════
    debounce(fn, ms) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    },

    esc(s) {
        if (!s) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(s).replace(/[&<>"']/g, c => map[c]);
    },

    shakeEl(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.borderColor = 'var(--danger)';
        el.style.boxShadow = '0 0 0 3px var(--danger-bg)';
        el.focus();
        setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 2000);
    },
};

// ─── Add mini styles for dashboard task items ───
const miniStyle = document.createElement('style');
miniStyle.textContent = `
    .dash-task-item {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 0;
        border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .dash-task-item:last-child { border-bottom: none; }
    .dash-task-title { font-size: 0.9rem; }
    .empty-mini {
        text-align: center; padding: 18px; font-size: 0.85rem;
        color: var(--text-dim);
    }
`;
document.head.appendChild(miniStyle);

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => App.init());