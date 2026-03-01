/**
 * Ödeme Takip - Ekip Paneli v1.0.1
 * Google Sheets API ile veri okuma/düzenleme
 * Google Identity Services ile kimlik doğrulama
 */

// ============================================================
// CONFIG — Bu değerleri kendi projenizden alın
// ============================================================
const CONFIG = {
    // Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client ID (Web)
    CLIENT_ID: '1024428338409-pp684rcmi26pt1119uvgcc7g9nm49pau.apps.googleusercontent.com',

    // Google Sheets API Scope + Identity Scopes
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email openid',

    // Spreadsheet ID — sheets_sync.py tarafından oluşturulur
    SPREADSHEET_ID: '1NQYdKIVLCD6o42nEIAAUtpkl0fomm6Rm4sOXsIwYw6o',

    // Sheet tab isimleri
    SHEETS: {
        JOBS: 'İşler',
        MEMBERS: 'Üyeler',
        PRICING: 'Fiyatlandırma',
        SERIES: 'Seriler'
    }
};

// ============================================================
// STATE
// ============================================================
let state = {
    user: null,
    isAdmin: false,
    tokenClient: null,
    accessToken: null,
    jobs: [],
    members: [],
    series: [],
    pricing: [],
    activeTab: 'jobs',
    searchQuery: '',
    filterRole: '',
    showOnlyMyJobs: false,
    sortColumn: null,
    sortDirection: 'asc'
};

// ============================================================
// INIT
// ============================================================
function initApp() {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: (response) => {
            if (response.error) {
                showToast('Giriş hatası: ' + response.error, 'error');
                return;
            }
            state.accessToken = response.access_token;
            // Token'ı kaydet (1 saat geçerli varsayıyoruz)
            localStorage.setItem('google_access_token', state.accessToken);
            localStorage.setItem('google_token_expiry', Date.now() + 3600000);
            onSignedIn();
        }
    });

    // Otomatik giriş kontrolü
    const savedToken = localStorage.getItem('google_access_token');
    const expiry = localStorage.getItem('google_token_expiry');
    if (savedToken && expiry && Date.now() < parseInt(expiry)) {
        state.accessToken = savedToken;
        onSignedIn();
    }
}

function handleSignIn() {
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes('YOUR_CLIENT_ID')) {
        showToast('Lütfen CONFIG.CLIENT_ID değerini ayarlayın!', 'error');
        return;
    }
    state.tokenClient.requestAccessToken();
}

function handleSignOut() {
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_expiry');

    if (state.accessToken) {
        google.accounts.oauth2.revoke(state.accessToken, () => {
            state.accessToken = null;
            state.user = null;
            state.isAdmin = false;
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('app-screen').style.display = 'none';
        });
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
}

async function onSignedIn() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${state.accessToken}` }
        });
        state.user = await res.json();
    } catch (e) {
        console.error('Userinfo error:', e);
        state.user = { name: 'Kullanıcı', picture: '', email: '' };
    }

    if (!state.user || !state.user.email) {
        showToast('Google hesabınızdan email bilgisi alınamadı. Lütfen yetkileri onaylayın.', 'error');
        handleSignOut();
        return;
    }

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    const userInfoEl = document.getElementById('user-info');
    userInfoEl.innerHTML = `
        ${state.user.picture ? `<img src="${state.user.picture}" alt="avatar">` : ''}
        <span>${state.user.name || state.user.email}</span>
    `;

    await loadAllData();
}

// ============================================================
// DATA LOADING
// ============================================================
async function sheetsGet(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`;
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${state.accessToken}` }
        });
        if (res.status === 401) return handleAuthError();
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Sheets API hatası');
        }
        const data = await res.json();
        return data.values || [];
    } catch (e) {
        if (e.message === 'AUTH_RETRY') throw e;
        throw e;
    }
}

async function sheetsUpdate(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${state.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values })
        });
        if (res.status === 401) return handleAuthError();
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Güncelleme hatası');
        }
        return await res.json();
    } catch (e) {
        if (e.message === 'AUTH_RETRY') throw e;
        throw e;
    }
}

async function sheetsAppend(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${state.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values })
        });
        if (res.status === 401) return handleAuthError();
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Ekleme hatası');
        }
        return await res.json();
    } catch (e) {
        if (e.message === 'AUTH_RETRY') throw e;
        throw e;
    }
}

function handleAuthError() {
    console.warn('Authentication expired, redirecting to login...');
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_expiry');
    state.accessToken = null;

    showToast('Oturum süresi doldu, lütfen tekrar giriş yapın.', 'info');

    // Uygulamayı giriş ekranına döndür
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';

    // Otomatik olarak giriş penceresini aç
    handleSignIn();

    // İşlemi durdurmak için hata fırlat
    throw new Error('AUTH_RETRY');
}

async function loadAllData() {
    showLoading(true);
    try {
        if (!CONFIG.SPREADSHEET_ID) {
            showLoading(false);
            showToast('SPREADSHEET_ID ayarlanmamış!', 'error');
            return;
        }

        const [jobsRaw, membersRaw, seriesRaw, pricingRaw] = await Promise.all([
            sheetsGet(`'${CONFIG.SHEETS.JOBS}'!A1:Z10000`),
            sheetsGet(`'${CONFIG.SHEETS.MEMBERS}'!A1:Z10000`),
            sheetsGet(`'${CONFIG.SHEETS.SERIES}'!A1:Z10000`),
            sheetsGet(`'${CONFIG.SHEETS.PRICING}'!A1:Z10000`)
        ]);

        state.jobs = parseSheetData(jobsRaw);
        state.members = parseSheetData(membersRaw);
        state.series = parseSheetData(seriesRaw);
        state.pricing = parseSheetData(pricingRaw);

        // Check Admin Status
        checkPermissions();

        updateStats();
        renderActiveTab();

        showToast(`Veriler yüklendi`, 'success');
    } catch (e) {
        showToast('Veri yükleme hatası: ' + e.message, 'error');
        console.error(e);
    } finally {
        showLoading(false);
    }
}

function parseSheetData(rawValues) {
    if (!rawValues || rawValues.length < 1) return [];
    const headers = rawValues[0];
    const rows = rawValues.slice(1);
    return rows
        .map((row, idx) => {
            const obj = { _rowIndex: idx + 2 };
            let hasData = false;
            headers.forEach((h, i) => {
                const val = row[i] || '';
                obj[h] = val;
                if (val && i < 10) hasData = true; // Check first 10 columns for any data
            });
            return hasData ? obj : null;
        })
        .filter(obj => obj !== null);
}

function checkPermissions() {
    const currentUserEmail = (state.user?.email || '').toLowerCase();

    if (!currentUserEmail) {
        state.isAdmin = false;
        return;
    }

    const member = state.members.find(m => (m['Email'] || '').toLowerCase() === currentUserEmail);
    const adminVal = (member && member['Admin'] || '').toUpperCase();
    state.isAdmin = adminVal === 'EVET' || adminVal === 'TRUE' || adminVal === '1';

    // UI Update: Hide Admin tabs if not admin
    const forbids = ['members', 'series', 'pricing'];
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (forbids.includes(btn.dataset.tab)) {
            btn.style.display = state.isAdmin ? '' : 'none';
        }
    });

    if (!state.isAdmin && forbids.includes(state.activeTab)) {
        switchTab('jobs');
    }
}

// ============================================================
// STATS
// ============================================================
function updateStats() {
    const jobs = getFilteredJobs();
    const totalJobs = jobs.length;
    const totalAmount = jobs.reduce((sum, j) => sum + parseFloat(j['Ücret (TL)'] || 0), 0);

    const statJobs = document.getElementById('stat-jobs');
    const statAmount = document.getElementById('stat-amount');
    const statMembers = document.getElementById('stat-members');
    const statSeries = document.getElementById('stat-series');

    if (statJobs) statJobs.textContent = totalJobs;
    if (statAmount) statAmount.textContent = totalAmount.toFixed(0) + ' TL';

    if (state.isAdmin) {
        if (statMembers) {
            statMembers.parentElement.style.display = 'flex';
            statMembers.textContent = state.members.length;
        }
        if (statSeries) {
            statSeries.parentElement.style.display = 'flex';
            statSeries.textContent = state.series.length;
        }
        document.querySelector('.stats-grid').style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    } else {
        if (statMembers) statMembers.parentElement.style.display = 'none';
        if (statSeries) statSeries.parentElement.style.display = 'none';
        document.querySelector('.stats-grid').style.gridTemplateColumns = 'repeat(2, 1fr)';
    }
}

function getFilteredJobs() {
    if (!state.user || !state.user.email) return [];

    let data = [...state.jobs];

    // Email Filtering — Admin olmayanlar veya "Sadece Benim" modundaki adminler sadece kendinisinkini görsün
    if (!state.isAdmin || state.showOnlyMyJobs) {
        const email = (state.user?.email || '').toLowerCase();
        data = data.filter(j => (j['Email'] || '').toLowerCase() === email);
    }
    return data;
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tabName) {
    state.activeTab = tabName;
    state.searchQuery = '';
    state.filterRole = '';
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    const searchBox = document.getElementById('search-box');
    if (searchBox) searchBox.value = '';
    renderActiveTab();
}

function renderActiveTab() {
    switch (state.activeTab) {
        case 'jobs': renderJobs(); break;
        case 'members': renderMembers(); break;
        case 'series': renderSeries(); break;
        case 'pricing': renderPricing(); break;
    }
}

// ============================================================
// RENDER JOBS
// ============================================================
function renderJobs() {
    let data = getFilteredJobs();

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        data = data.filter(j =>
            (j['Seri'] || '').toLowerCase().includes(q) ||
            (j['Üye Adı'] || '').toLowerCase().includes(q) ||
            (j['Email'] || '').toLowerCase().includes(q) ||
            (j['Rol'] || '').toLowerCase().includes(q)
        );
    }

    if (state.filterRole) {
        data = data.filter(j => (j['Rol'] || '').includes(state.filterRole));
    }

    if (state.sortColumn) {
        data.sort((a, b) => {
            let va = a[state.sortColumn] || '';
            let vb = b[state.sortColumn] || '';
            if (['Ref KB', 'Ücret (TL)', 'Bölüm'].includes(state.sortColumn)) {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            }
            if (va < vb) return state.sortDirection === 'asc' ? -1 : 1;
            if (va > vb) return state.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const editableCols = ['Seri', 'Bölüm', 'Rol', 'Ref KB', 'Ücret (TL)', 'Üye Adı', 'Email', 'Zorluk'];
    const columns = ['Tarih', 'Seri', 'Bölüm', 'Rol', 'Ref KB', 'Ücret (TL)', 'Üye Adı', 'Email'];
    if (state.isAdmin) columns.push('Aksiyon');

    renderToolbar(true);

    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(col => {
        const arrow = state.sortColumn === col ? (state.sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
        html += `<th onclick="sortBy('${col}')">${col}${arrow}</th>`;
    });
    html += '</tr></thead><tbody>';

    if (data.length === 0) {
        html += `<tr><td colspan="${columns.length}"><div class="empty-state"><div class="icon">📋</div><h3>İş bulunamadı</h3></div></td></tr>`;
    } else {
        let lastSeries = '';
        data.forEach(job => {
            const currentSeries = job['Seri'] || '';
            if (currentSeries !== lastSeries && currentSeries && state.isAdmin) {
                html += `<tr><td colspan="${columns.length}" style="background:rgba(255,255,255,0.03);padding:12px 16px;font-weight:700;color:var(--accent-blue);border-left:4px solid var(--accent-blue);font-family:var(--font-heading);">📚 ${escapeHtml(currentSeries)}</td></tr>`;
                lastSeries = currentSeries;
            }
            html += `<tr class="clickable" onclick="openEditJobModal(${job._rowIndex})">`;
            columns.forEach(col => {
                const val = job[col] || '';
                const isEditable = editableCols.includes(col);
                const colIndex = getColumnIndex(CONFIG.SHEETS.JOBS, col);

                // Üye kamp durumunu kontrol et
                const jobMember = state.members.find(m => (m['Email'] || '').toLowerCase() === (job['Email'] || '').toLowerCase());
                const isOnCamp = jobMember && jobMember['Kamp'] === 'Evet';

                if (col === 'Dosya') {
                    if (val && val.startsWith('http')) {
                        html += `<td data-label="${col}"><a href="${val}" target="_blank" style="color:var(--accent-blue);font-weight:600;text-decoration:none;" onclick="event.stopPropagation()">📄 DOSYA</a></td>`;
                    } else {
                        html += `<td data-label="${col}" style="color:var(--text-muted);">—</td>`;
                    }
                } else if (col === 'Rol') {
                    let cellVal = getRoleBadge(val);
                    if (isOnCamp) cellVal += ' <span class="role-badge kamp" style="font-size:0.6rem;padding:1px 4px;">KAMP</span>';
                    html += `<td data-label="${col}">${cellVal}</td>`;
                } else if (col === 'Ücret (TL)') {
                    const displayAmt = isOnCamp ? '0' : parseFloat(val || 0).toFixed(0);
                    html += `<td data-label="${col}" class="amount" style="${isOnCamp ? 'color:var(--accent-red);opacity:0.6;' : ''}">${displayAmt} TL</td>`;
                } else {
                    html += `<td data-label="${col}">${escapeHtml(val)}</td>`;
                }
            });
            if (state.isAdmin) {
                html += `
                <td style="text-align:center">
                    <button class="btn-delete" 
                            onclick="event.stopPropagation(); deleteJob(${job._rowIndex})">
                        X
                    </button>
                </td>`;
            }
            html += '</tr>';
        });
    }

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// RENDER MEMBERS
// ============================================================
function renderMembers() {
    if (!state.isAdmin) return;
    let data = [...state.members];

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        data = data.filter(m =>
            (m['İsim'] || '').toLowerCase().includes(q) ||
            (m['Email'] || '').toLowerCase().includes(q) ||
            (m['Rol'] || '').toLowerCase().includes(q)
        );
    }

    const columns = ['ID', 'İsim', 'Email', 'Rol', 'Aktif', 'Karaliste', 'Admin', 'Kamp', 'Mezuniyet', 'Toplam Kazanç'];
    const editableCols = ['İsim', 'Email', 'Rol', 'Aktif', 'Karaliste', 'Admin', 'Kamp', 'Mezuniyet'];

    renderToolbar(false);

    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(col => html += `<th>${col}</th>`);
    html += '</tr></thead><tbody>';

    data.forEach((member, idx) => {
        html += `<tr class="clickable" onclick="openEditMemberModal(${member._rowIndex - 2})">`;
        columns.forEach(col => {
            const val = member[col] || '';
            if (col === 'Rol') {
                html += `<td data-label="${col}">${getRoleBadge(val)}</td>`;
            } else if (col === 'Kamp') {
                const badge = val === 'Evet' ? '<span class="role-badge kamp">KAMP</span>' : '<span class="role-badge" style="opacity:0.3">HAYIR</span>';
                html += `<td data-label="${col}">${badge}</td>`;
            } else if (col === 'Admin') {
                const badge = val === 'Evet' ? '<span class="role-badge" style="background:rgba(79,140,255,0.1);color:var(--accent-blue);">ADMİN</span>' : '<span class="role-badge" style="opacity:0.3">ÜYE</span>';
                html += `<td data-label="${col}">${badge}</td>`;
            } else if (col === 'Karaliste') {
                const badge = val === 'Evet' ? '<span class="role-badge black">HAYIR</span>' : '<span class="role-badge" style="opacity:0.3">TEMİZ</span>';
                html += `<td data-label="${col}">${badge}</td>`;
            } else if (col === 'Toplam Kazanç') {
                const email = (member['Email'] || '').toLowerCase();
                const total = state.jobs
                    .filter(j => (j['Email'] || '').toLowerCase() === email)
                    .reduce((sum, j) => sum + parseFloat(j['Ücret (TL)'] || 0), 0);

                html += `
                    <td data-label="${col}" 
                        onclick="event.stopPropagation(); viewMemberJobs('${email}', '${escapeHtml(member['İsim'] || '')}')"
                        title="İş geçmişini görüntüle"
                        style="font-weight:800; color:var(--accent-green); cursor:pointer; text-decoration:underline; background: rgba(16,185,129,0.05);">
                        ${Math.round(total)} TL
                    </td>`;
            } else {
                html += `<td data-label="${col}">${escapeHtml(val)}</td>`;
            }
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// MEMBER JOBS VIEW
// ============================================================
function viewMemberJobs(email, name) {
    const jobs = state.jobs.filter(j => (j['Email'] || '').toLowerCase() === email.toLowerCase());
    const tbody = document.getElementById('member-jobs-table-body');
    const tfoot = document.getElementById('member-jobs-table-footer');
    const summary = document.getElementById('member-jobs-total-summary');
    const title = document.getElementById('member-jobs-title');
    const subtitle = document.getElementById('member-jobs-subtitle');

    title.textContent = `${name} - İş Geçmişi`;
    subtitle.textContent = `${email} | Toplam ${jobs.length} iş`;

    let totalSum = 0;
    let html = '';

    if (jobs.length === 0) {
        html = '<tr><td colspan="6" style="text-align:center; padding:40px;">Bu üyeye ait henüz bir iş kaydı bulunamadı.</td></tr>';
        tfoot.innerHTML = '';
        summary.textContent = '';
    } else {
        // Sort by date descending
        const sortedJobs = [...jobs].sort((a, b) => new Date(b['Tarih'] || 0) - new Date(a['Tarih'] || 0));

        sortedJobs.forEach(job => {
            const amount = parseFloat(job['Ücret (TL)'] || 0);
            totalSum += amount;

            html += `
                <tr>
                    <td data-label="Tarih">${job['Tarih'] || ''}</td>
                    <td data-label="Seri">${job['Seri'] || ''}</td>
                    <td data-label="Bölüm">${job['Bölüm'] || ''}</td>
                    <td data-label="Rol">${getRoleBadge(job['Rol'] || '')}</td>
                    <td data-label="KB">${job['Size (KB/Bölüm)'] || '0'}</td>
                    <td data-label="Ücret" style="font-weight:700; color:var(--accent-green);">${Math.round(amount)} TL</td>
                </tr>
            `;
        });

        tfoot.innerHTML = `
            <tr style="background: rgba(16,185,129,0.1); font-weight: 800;">
                <td colspan="5" style="text-align: right;">GENEL TOPLAM:</td>
                <td style="color: var(--accent-green);">${Math.round(totalSum)} TL</td>
            </tr>
        `;
        summary.textContent = `Toplam: ${Math.round(totalSum)} TL`;
    }

    tbody.innerHTML = html;
    document.getElementById('member-jobs-modal').classList.add('active');
}

function closeMemberJobsModal() {
    document.getElementById('member-jobs-modal').classList.remove('active');
}


// ============================================================
// RENDER SERIES
// ============================================================
function renderSeries() {
    if (!state.isAdmin) return;
    let data = [...state.series];

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        data = data.filter(s => (s['Seri Adı'] || '').toLowerCase().includes(q));
    }

    const columns = ['ID', 'Seri Adı', 'Zorluk', 'Ana ID', 'Çevirmen ID', 'Acemi Çevirmen ID', 'Dizgici ID', 'Acemi Dizgici ID', 'Temizlikçi ID'];
    const editableCols = ['Seri Adı', 'Zorluk'];

    renderToolbar(false);

    let html = '<div style="margin-bottom:16px; display:flex; justify-content:flex-end;">';
    html += '<button class="btn-action primary" onclick="openAddSeriesModal()" style="width:auto; padding: 8px 16px;">✨ Yeni Seri Ekle</button>';
    html += '</div>';

    html += '<table class="data-table"><thead><tr>';
    columns.forEach(col => html += `<th>${col}</th>`);
    html += '</tr></thead><tbody>';

    data.forEach((series, idx) => {
        html += `<tr class="clickable" onclick="openEditSeriesModal(${series._rowIndex - 2})">`;
        columns.forEach(col => {
            let val = series[col] || '';
            if (col.includes('ID') && val.length > 5) {
                // IDs are usually long strings, show as a mini badge with title
                html += `<td data-label="${col}"><span class="role-badge" style="background:rgba(79,140,255,0.1);color:var(--accent-blue);font-size:0.7rem;" title="${val}">${val.substring(0, 8)}...</span></td>`;
            } else {
                html += `<td data-label="${col}">${escapeHtml(val)}</td>`;
            }
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// RENDER PRICING
// ============================================================
function renderPricing() {
    if (!state.isAdmin) return;
    const data = [...state.pricing];
    const columns = [
        'Geçerlilik',
        'Çeviri 0-3 KB', 'Çeviri 3-6 KB', 'Çeviri 6-8 KB', 'Çeviri 8+ KB',
        'Editör İndirimi',
        'Dizgi 0-3 KB', 'Dizgi 3-6 KB', 'Dizgi 6-7 KB', 'Dizgi 7+ KB',
        'Temiz ZOR', 'Temiz ORTA', 'Temiz KOLAY', 'Temiz EN KOLAY',
        'Acemi Çarpanı'
    ];

    renderToolbar(false);

    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(col => html += `<th>${col}</th>`);
    html += '</tr></thead><tbody>';

    data.forEach(p => {
        html += '<tr>';
        columns.forEach(col => {
            const val = p[col] || '';
            const colIndex = getColumnIndex(CONFIG.SHEETS.PRICING, col);
            html += `<td data-label="${col}" class="editable" ondblclick="startEdit(this, '${CONFIG.SHEETS.PRICING}', ${p._rowIndex}, ${colIndex}, '${col}')">${escapeHtml(val)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// TOOLBAR
// ============================================================
function renderToolbar(showRoleFilter, force = false) {
    const toolbarEl = document.getElementById('toolbar');

    // Search focus fix: If toolbar exists and we are just updating value
    const existingSearch = document.getElementById('search-box');
    if (existingSearch && !force) {
        if (existingSearch.value !== (state.searchQuery || '')) {
            existingSearch.value = state.searchQuery || '';
        }
        // If nothing else changed, don't re-render everything
        if (toolbarEl.dataset.showRoleFilter === String(showRoleFilter)) return;
    }

    toolbarEl.dataset.showRoleFilter = showRoleFilter;

    let html = `
        <input type="text" class="search-box" id="search-box"
               placeholder="🔍 Ara... (isim, seri, email)"
               value="${state.searchQuery}"
               oninput="handleSearch(this.value)">
    `;

    if (showRoleFilter) {
        html += `
            <select onchange="handleRoleFilter(this.value)">
                <option value="">Tüm Roller</option>
                <option value="Çevirmen" ${state.filterRole === 'Çevirmen' ? 'selected' : ''}>Çevirmen</option>
                <option value="Dizgici" ${state.filterRole === 'Dizgici' ? 'selected' : ''}>Dizgici</option>
                <option value="Temizlikçi" ${state.filterRole === 'Temizlikçi' ? 'selected' : ''}>Temizlikçi</option>
                <option value="Redaktör" ${state.filterRole === 'Redaktör' ? 'selected' : ''}>Redaktör</option>
                <option value="Acemi" ${state.filterRole === 'Acemi' ? 'selected' : ''}>Acemi</option>
            </select>
        `;

        // Admin'e özel "Sadece Benim İşlerim" butonu
        html += `
            <button class="btn-action ${state.showOnlyMyJobs ? 'primary' : 'secondary'}" 
                    onclick="toggleMyJobs()" 
                    title="Sadece kendi işlerinizi görmek için tıklayın">
                ${state.showOnlyMyJobs ? '👥 Tüm İşler' : '👤 Sadece Benim'}
            </button>
        `;
    }

    html += `<button class="btn-action primary" onclick="openAddJobModal()">✨ Yeni İş Ekle</button>`;
    html += `<button class="btn-action secondary" onclick="document.getElementById('html-upload-input').click()">📁 HTML'den Aktar</button>`;
    html += `<button class="btn-action secondary" onclick="loadAllData()">🔄 Yenile</button>`;

    toolbarEl.innerHTML = html;
}

function startEdit(cell, sheetName, rowIndex, colIndex, columnName) {
    if (cell.querySelector('.inline-edit')) return;

    // Badge içindeki metni veya ham metni al
    let currentValue = cell.textContent.trim();
    if (currentValue === 'KAMP') currentValue = 'Evet';
    if (currentValue === 'HAYIR') currentValue = 'Hayır';

    const originalHTML = cell.innerHTML;

    let input;
    const isBooleanCol = ['Kamp', 'Aktif', 'Karaliste', 'Admin'].includes(columnName);
    const isDateCol = ['Mezuniyet', 'Tarih', 'Geçerlilik'].includes(columnName);
    const isDifficultyCol = ['Zorluk'].includes(columnName);
    const isSeriesCol = ['Seri'].includes(columnName);
    const isEmailCol = ['Email'].includes(columnName);

    if (isBooleanCol) {
        input = document.createElement('select');
        input.className = 'inline-edit';
        input.innerHTML = `
            <option value="Evet" ${currentValue === 'Evet' ? 'selected' : ''}>Evet</option>
            <option value="Hayır" ${currentValue === 'Hayır' ? 'selected' : ''}>Hayır</option>
        `;
    } else if (isDifficultyCol) {
        input = document.createElement('select');
        input.className = 'inline-edit';
        input.innerHTML = `
            <option value="EN_KOLAY" ${currentValue === 'EN_KOLAY' ? 'selected' : ''}>EN_KOLAY</option>
            <option value="KOLAY" ${currentValue === 'KOLAY' ? 'selected' : ''}>KOLAY</option>
            <option value="ORTA" ${currentValue === 'ORTA' ? 'selected' : ''}>ORTA</option>
            <option value="ZOR" ${currentValue === 'ZOR' ? 'selected' : ''}>ZOR</option>
        `;
    } else if (isSeriesCol) {
        input = document.createElement('select');
        input.className = 'inline-edit';
        input.innerHTML = state.series.map(s =>
            `<option value="${escapeHtml(s['Seri Adı'])}" ${s['Seri Adı'] === currentValue ? 'selected' : ''}>${escapeHtml(s['Seri Adı'])}</option>`
        ).join('');
    } else if (isEmailCol) {
        input = document.createElement('select');
        input.className = 'inline-edit';
        input.innerHTML = state.members.map(m =>
            `<option value="${escapeHtml(m['Email'])}" ${m['Email'] === currentValue ? 'selected' : ''}>${escapeHtml(m['İsim'])} (${escapeHtml(m['Email'])})</option>`
        ).join('');
    } else {
        input = document.createElement('input');
        input.className = 'inline-edit';
        input.type = isDateCol ? 'date' : 'text';
        input.value = currentValue.replace(' TL', '');
    }

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    if (input.select && !isDateCol) input.select();

    // Dropdownlar için seçer seçmez kaydet
    if (isBooleanCol || isDifficultyCol || isSeriesCol || isEmailCol) {
        input.addEventListener('change', async () => {
            await saveEdit(cell, sheetName, rowIndex, colIndex, input.value, originalHTML);
        });
    }

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            await saveEdit(cell, sheetName, rowIndex, colIndex, input.value, originalHTML);
        } else if (e.key === 'Escape') {
            cell.innerHTML = originalHTML;
        }
    });

    // Blur olduğunda eğer seçmeli değilse (dropdown değilse) iptal et veya kaydet
    input.addEventListener('blur', async () => {
        // Dropdownlarda change zaten kaydetti, date için blur'da kaydetmek iyi olabilir
        setTimeout(async () => {
            if (cell.querySelector('.inline-edit')) {
                if (isDateCol && input.value && input.value !== currentValue) {
                    await saveEdit(cell, sheetName, rowIndex, colIndex, input.value, originalHTML);
                } else {
                    cell.innerHTML = originalHTML;
                }
            }
        }, 200);
    });
}

async function saveEdit(cell, sheetName, rowIndex, colIndex, newValue, fallbackHTML) {
    const colLetter = String.fromCharCode(64 + colIndex);
    const range = `'${sheetName}'!${colLetter}${rowIndex}`;

    try {
        await sheetsUpdate(range, [[newValue]]);
        cell.innerHTML = escapeHtml(newValue);
        showToast('Güncellendi ✓', 'success');
        await loadAllData();
    } catch (e) {
        cell.innerHTML = fallbackHTML;
        showToast('Güncelleme hatası: ' + e.message, 'error');
    }
}

// ============================================================
// ADD JOB MODAL LOGIC
// ============================================================
function openAddJobModal() {
    const select = document.getElementById('add-job-series');
    select.innerHTML = state.series.map(s =>
        `<option value="${escapeHtml(s['Seri Adı'])}">${escapeHtml(s['Seri Adı'])}</option>`
    ).join('');

    document.getElementById('add-job-chapter').value = '';
    document.getElementById('add-job-kb').value = '';
    document.getElementById('add-job-file').value = '';
    document.getElementById('add-job-email').value = state.user?.email || '';

    // Admin email selection
    const emailGroup = document.getElementById('add-job-email-group');
    const datalist = document.getElementById('member-emails-list');
    if (state.isAdmin) {
        emailGroup.style.display = 'block';
        datalist.innerHTML = state.members.map(m =>
            `<option value="${escapeHtml(m['Email'])}">${escapeHtml(m['İsim'])} (${escapeHtml(m['Rol'])})</option>`
        ).join('');
    } else {
        emailGroup.style.display = 'none';
    }

    // Member's default role
    const member = state.members.find(m => (m['Email'] || '').toLowerCase() === (state.user?.email || '').toLowerCase());
    if (member && member['Rol']) {
        document.getElementById('add-job-role').value = member['Rol'];
    }

    document.getElementById('add-job-modal').classList.add('active');

    // Add real-time listeners for price calculation
    ['add-job-kb', 'add-job-role', 'add-job-series', 'add-job-email'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.removeEventListener('input', updatePriceEstimate);
            el.removeEventListener('change', updatePriceEstimate);
            el.addEventListener('input', updatePriceEstimate);
            el.addEventListener('change', updatePriceEstimate);
        }
    });
    updatePriceEstimate();
}

function closeAddJobModal() {
    document.getElementById('add-job-modal').classList.remove('active');
}

// ============================================================
// MEMBER EDIT MODAL LOGIC
// ============================================================
function openEditMemberModal(idx) {
    const member = state.members[idx];
    if (!member) return;

    document.getElementById('edit-member-index').value = idx;
    document.getElementById('edit-member-name').value = member['İsim'] || '';
    document.getElementById('edit-member-role').value = member['Rol'] || '';
    document.getElementById('edit-member-active').value = (member['Aktif'] === 'Evet') ? 'Evet' : 'Hayır';
    document.getElementById('edit-member-admin').value = (member['Admin'] === 'Evet') ? 'Evet' : 'Hayır';
    document.getElementById('edit-member-camp').value = (member['Kamp'] === 'Evet') ? 'Evet' : 'Hayır';
    document.getElementById('edit-member-blacklist').value = (member['Karaliste'] === 'Evet') ? 'Evet' : 'Hayır';
    document.getElementById('edit-member-graduation').value = member['Mezuniyet'] || '';

    document.getElementById('edit-member-modal').classList.add('active');
}

function closeEditMemberModal() {
    document.getElementById('edit-member-modal').classList.remove('active');
}

async function submitEditMember() {
    const idx = document.getElementById('edit-member-index').value;
    const member = state.members[idx];
    if (!member) return;

    const updates = {
        'Rol': document.getElementById('edit-member-role').value,
        'Aktif': document.getElementById('edit-member-active').value,
        'Admin': document.getElementById('edit-member-admin').value,
        'Kamp': document.getElementById('edit-member-camp').value,
        'Karaliste': document.getElementById('edit-member-blacklist').value,
        'Mezuniyet': document.getElementById('edit-member-graduation').value
    };

    showLoading(true);
    try {
        const promises = [];
        for (const [col, val] of Object.entries(updates)) {
            const colIndex = getColumnIndex(CONFIG.SHEETS.MEMBERS, col);
            const colLetter = String.fromCharCode(64 + colIndex);
            const range = `'${CONFIG.SHEETS.MEMBERS}'!${colLetter}${member._rowIndex}`;
            promises.push(sheetsUpdate(range, [[val]]));
        }

        await Promise.all(promises);
        showToast('Üye bilgileri güncellendi! ✓', 'success');
        closeEditMemberModal();
        await loadAllData();
    } catch (e) {
        showToast('Güncelleme hatası: ' + e.message, 'error');
        console.error(e);
    } finally {
        showLoading(false);
    }
}

// ============================================================
// SERIES LOGIC
// ============================================================
function openAddSeriesModal() {
    document.getElementById('add-series-modal').classList.add('active');
}

function closeAddSeriesModal() {
    document.getElementById('add-series-modal').classList.remove('active');
}

async function submitAddSeries() {
    const payload = [
        'NEW',
        document.getElementById('add-series-name').value.trim(),
        document.getElementById('add-series-difficulty').value,
        document.getElementById('add-series-main-id').value.trim(),
        document.getElementById('add-series-translator-id').value.trim(),
        document.getElementById('add-series-trainee-translator-id').value.trim(),
        document.getElementById('add-series-typesetter-id').value.trim(),
        document.getElementById('add-series-trainee-typesetter-id').value.trim(),
        document.getElementById('add-series-cleaner-id').value.trim()
    ];

    if (!payload[1]) {
        showToast('Lütfen seri adını girin!', 'error');
        return;
    }

    showLoading(true);
    try {
        const rowData = [payload];
        const range = `'${CONFIG.SHEETS.SERIES}'!A2`;
        await sheetsUpdate(range, rowData);

        showToast('Seri eklendi! ✓', 'success');
        closeAddSeriesModal();
        await loadAllData();
    } finally {
        showLoading(false);
    }
}

function openEditSeriesModal(idx) {
    const series = state.series[idx];
    if (!series) return;

    document.getElementById('edit-series-index').value = idx;
    document.getElementById('edit-series-name').value = series['Seri Adı'] || '';
    document.getElementById('edit-series-difficulty').value = series['Zorluk'] || 'ORTA';
    document.getElementById('edit-series-main-id').value = series['Ana ID'] || '';
    document.getElementById('edit-series-translator-id').value = series['Çevirmen ID'] || '';
    document.getElementById('edit-series-trainee-translator-id').value = series['Acemi Çevirmen ID'] || '';
    document.getElementById('edit-series-typesetter-id').value = series['Dizgici ID'] || '';
    document.getElementById('edit-series-trainee-typesetter-id').value = series['Acemi Dizgici ID'] || '';
    document.getElementById('edit-series-cleaner-id').value = series['Temizlikçi ID'] || '';

    document.getElementById('edit-series-modal').classList.add('active');
}

function closeEditSeriesModal() {
    document.getElementById('edit-series-modal').classList.remove('active');
}

async function submitEditSeries() {
    const idx = document.getElementById('edit-series-index').value;
    const series = state.series[idx];
    if (!series) return;

    const updates = {
        'Zorluk': document.getElementById('edit-series-difficulty').value,
        'Ana ID': document.getElementById('edit-series-main-id').value.trim(),
        'Çevirmen ID': document.getElementById('edit-series-translator-id').value.trim(),
        'Acemi Çevirmen ID': document.getElementById('edit-series-trainee-translator-id').value.trim(),
        'Dizgici ID': document.getElementById('edit-series-typesetter-id').value.trim(),
        'Acemi Dizgici ID': document.getElementById('edit-series-trainee-typesetter-id').value.trim(),
        'Temizlikçi ID': document.getElementById('edit-series-cleaner-id').value.trim()
    };

    showLoading(true);
    try {
        const promises = [];
        for (const [col, val] of Object.entries(updates)) {
            const colIndex = getColumnIndex(CONFIG.SHEETS.SERIES, col);
            const colLetter = String.fromCharCode(64 + colIndex);
            const range = `'${CONFIG.SHEETS.SERIES}'!${colLetter}${series._rowIndex}`;
            promises.push(sheetsUpdate(range, [[val]]));
        }

        await Promise.all(promises);
        showToast('Seri güncellendi! ✓', 'success');
        closeEditSeriesModal();
        await loadAllData();
    } catch (e) {
        showToast('Güncelleme hatası: ' + e.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function submitAddJob() {
    const series = document.getElementById('add-job-series').value;
    const chapter = document.getElementById('add-job-chapter').value;
    const kb = parseFloat(document.getElementById('add-job-kb').value || 0);
    const role = document.getElementById('add-job-role').value;
    const file = document.getElementById('add-job-file').value;

    if (!series || !chapter) {
        showToast('Lütfen seri ve bölüm alanlarını doldurun!', 'error');
        return;
    }

    showLoading(true);
    try {
        const today = new Date().toISOString().split('T')[0];
        const member = state.members.find(m => (m['Email'] || '').toLowerCase() === (state.user?.email || '').toLowerCase());
        const memberName = member ? member['İsim'] : (state.user?.name || '');

        let memberEmail = state.user?.email || '';
        if (state.isAdmin) {
            const selectedEmail = document.getElementById('add-job-email').value.trim();
            if (selectedEmail) {
                memberEmail = selectedEmail;
                // Update member name for the row if found
                const targetMember = state.members.find(m => (m['Email'] || '').toLowerCase() === selectedEmail.toLowerCase());
                if (targetMember) {
                    // memberName will be used from targetMember effectively if we want, 
                    // but usually it's better to keep the email as source of truth.
                }
            }
        }

        // Find difficulty and calculate price
        const s = state.series.find(x => x['Seri Adı'] === series);
        const difficulty = s ? s['Zorluk'] : 'ORTA';
        const price = calculateJobPrice(role, kb, difficulty, memberEmail, today);

        // Row format: ID, Tarih, Seri, Bölüm, Dosya, Rol, Ref KB, Ücret (TL), Üye Adı, Email, Zorluk
        const newRow = [
            'NEW',
            today,
            series,
            chapter,
            file,
            role,
            kb,
            price,
            memberName,
            memberEmail,
            difficulty
        ];

        await sheetsAppend(`'${CONFIG.SHEETS.JOBS}'!A2`, [newRow]);

        showToast('İş başarıyla eklendi! ✨', 'success');
        closeAddJobModal();
        await loadAllData();
    } catch (e) {
        showToast('Ekleme hatası: ' + e.message, 'error');
        console.error(e);
    } finally {
        showLoading(false);
    }
}

// ============================================================
// JOB EDIT MODAL LOGIC
// ============================================================
function openEditJobModal(idx) {
    const job = state.jobs.find(j => j._rowIndex === idx);
    if (!job) return;

    document.getElementById('edit-job-index').value = idx;

    // Fill Series select
    const seriesSelect = document.getElementById('edit-job-series');
    seriesSelect.innerHTML = state.series.map(s =>
        `<option value="${s['Seri Adı']}" ${s['Seri Adı'] === job['Seri'] ? 'selected' : ''}>${s['Seri Adı']}</option>`
    ).join('');

    document.getElementById('edit-job-chapter').value = job['Bölüm'] || '';
    document.getElementById('edit-job-kb').value = job['Ref KB'] || 0;
    document.getElementById('edit-job-role').value = job['Rol'] || 'Çevirmen';
    document.getElementById('edit-job-file').value = (job['Dosya'] || '').startsWith('http') ? job['Dosya'] : '';
    document.getElementById('edit-job-price').value = job['Ücret (TL)'] || 0;

    if (state.isAdmin) {
        document.getElementById('edit-job-email-group').style.display = 'block';
        document.getElementById('edit-job-email').value = job['Email'] || '';
    } else {
        document.getElementById('edit-job-email-group').style.display = 'none';
    }

    document.getElementById('edit-job-modal').classList.add('active');
    updateEditPriceEstimate();
}

function closeEditJobModal() {
    document.getElementById('edit-job-modal').classList.remove('active');
}

function updateEditPriceEstimate() {
    const role = document.getElementById('edit-job-role').value;
    const kb = parseFloat(document.getElementById('edit-job-kb').value || 0);
    const seriesName = document.getElementById('edit-job-series').value;
    const email = state.isAdmin ? document.getElementById('edit-job-email').value : state.user.email;

    const idx = document.getElementById('edit-job-index').value;
    const job = state.jobs.find(j => j._rowIndex === parseInt(idx));
    const jobDate = job ? job['Tarih'] : null; // Get the job date from the existing job

    const s = state.series.find(x => x['Seri Adı'] === seriesName);
    const difficulty = s ? s['Zorluk'] : 'ORTA';

    const price = calculateJobPrice(role, kb, difficulty, email, jobDate);
    document.getElementById('edit-job-price').value = price;
}

async function submitEditJob() {
    const idx = document.getElementById('edit-job-index').value;
    const job = state.jobs.find(j => j._rowIndex === parseInt(idx));
    if (!job) return;

    const seriesName = document.getElementById('edit-job-series').value;
    const chapter = document.getElementById('edit-job-chapter').value.trim();
    const role = document.getElementById('edit-job-role').value;
    const kb = parseFloat(document.getElementById('edit-job-kb').value || 0);
    const file = document.getElementById('edit-job-file').value.trim();
    const price = document.getElementById('edit-job-price').value;
    const email = state.isAdmin ? document.getElementById('edit-job-email').value.trim() : job['Email'];

    if (!seriesName || !chapter) {
        showToast('Lütfen seri ve bölüm alanlarını doldurun!', 'error');
        return;
    }

    showLoading(true);
    try {
        const s = state.series.find(x => x['Seri Adı'] === seriesName);
        const difficulty = s ? s['Zorluk'] : 'ORTA';

        const updates = {
            'Seri': seriesName,
            'Bölüm': chapter,
            'Rol': role,
            'Ref KB': kb,
            'Dosya': file,
            'Ücret (TL)': price,
            'Zorluk': difficulty
        };

        if (state.isAdmin) {
            updates['Email'] = email;
            // Üye adını da güncelle (Veya SQL tarafına bırak)
            const m = state.members.find(m => (m['Email'] || '').toLowerCase() === email.toLowerCase());
            if (m) updates['Üye Adı'] = m['İsim'];
        }

        const promises = [];
        for (const [col, val] of Object.entries(updates)) {
            const colIndex = getColumnIndex(CONFIG.SHEETS.JOBS, col);
            const colLetter = String.fromCharCode(64 + colIndex);
            const range = `'${CONFIG.SHEETS.JOBS}'!${colLetter}${job._rowIndex}`;
            promises.push(sheetsUpdate(range, [[val]]));
        }

        await Promise.all(promises);
        showToast('İş başarıyla güncellendi! ✓', 'success');
        closeEditJobModal();
        await loadAllData();
    } catch (e) {
        showToast('Güncelleme hatası: ' + e.message, 'error');
        console.error(e);
    } finally {
        showLoading(false);
    }
}

// ============================================================
// COLUMN INDEX MAPPING
// ============================================================
function getColumnIndex(sheetName, columnName) {
    const columnMaps = {
        [CONFIG.SHEETS.JOBS]: {
            'ID': 1, 'Tarih': 2, 'Seri': 3, 'Bölüm': 4, 'Dosya': 5,
            'Rol': 6, 'Ref KB': 7, 'Ücret (TL)': 8, 'Üye Adı': 9,
            'Email': 10, 'Zorluk': 11
        },
        [CONFIG.SHEETS.MEMBERS]: {
            'ID': 1, 'İsim': 2, 'Email': 3, 'Rol': 4, 'Aktif': 5, 'Karaliste': 6, 'Admin': 7, 'Kamp': 8, 'Mezuniyet': 9
        },
        [CONFIG.SHEETS.SERIES]: {
            'ID': 1, 'Seri Adı': 2, 'Zorluk': 3, 'Ana ID': 4,
            'Çevirmen ID': 5, 'Acemi Çevirmen ID': 6, 'Dizgici ID': 7,
            'Acemi Dizgici ID': 8, 'Temizlikçi ID': 9
        },
        [CONFIG.SHEETS.PRICING]: {
            'Geçerlilik': 1,
            'Çeviri 0-3 KB': 2, 'Çeviri 3-6 KB': 3, 'Çeviri 6-8 KB': 4, 'Çeviri 8+ KB': 5,
            'Editör İndirimi': 6,
            'Dizgi 0-3 KB': 7, 'Dizgi 3-6 KB': 8, 'Dizgi 6-7 KB': 9, 'Dizgi 7+ KB': 10,
            'Temiz ZOR': 11, 'Temiz ORTA': 12, 'Temiz KOLAY': 13, 'Temiz EN KOLAY': 14,
            'Acemi Çarpanı': 15
        }
    };
    return columnMaps[sheetName]?.[columnName] || 1;
}

// ============================================================
// HELPERS
// ============================================================
function handleSearch(value) {
    state.searchQuery = value;
    renderActiveTab();
}

function handleRoleFilter(value) {
    state.filterRole = value;
    renderActiveTab();
}

function toggleMyJobs() {
    state.showOnlyMyJobs = !state.showOnlyMyJobs;
    renderActiveTab();
}

function sortBy(column) {
    if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortColumn = column;
        state.sortDirection = 'asc';
    }
    renderActiveTab();
}

function getRoleBadge(role) {
    if (!role) return '';
    let cls = '';
    if (role.includes('Çevirmen')) cls = 'cevirmen';
    else if (role.includes('Dizgici')) cls = 'dizgici';
    else if (role.includes('Temizlikçi')) cls = 'temizlikci';
    else if (role.includes('Redaktör') || role.includes('Editör')) cls = 'redaktor';
    if (role.includes('Acemi')) cls = 'acemi';
    return `<span class="role-badge ${cls}">${escapeHtml(role)}</span>`;
}

function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
// PRICE CALCULATION LOGIC (Mirroring calculator.py)
// ============================================================
function updatePriceEstimate() {
    const seriesName = document.getElementById('add-job-series').value;
    const role = document.getElementById('add-job-role').value;
    const kb = parseFloat(document.getElementById('add-job-kb').value || 0);
    const email = document.getElementById('add-job-email').value.trim();

    const series = state.series.find(s => s['Seri Adı'] === seriesName);
    const difficulty = series ? series['Zorluk'] : 'ORTA';

    const jobDate = new Date().toISOString().split('T')[0];
    const price = calculateJobPrice(role, kb, difficulty, email, jobDate);

    const estimateEl = document.getElementById('add-job-price-estimate');
    if (kb > 0 || role.includes('Temiz')) {
        estimateEl.style.display = 'block';
        estimateEl.querySelector('.value').textContent = price + ' TL';
    } else {
        estimateEl.style.display = 'none';
    }
}

function calculateJobPrice(role, kb, difficulty = 'ORTA', targetEmail = null, jobDate = null) {
    // Check if user is on camp (from state.members)
    const emailToCheck = (targetEmail || state.user?.email || '').toLowerCase();
    const member = state.members.find(m => (m['Email'] || '').toLowerCase() === emailToCheck);

    if (member && member['Kamp'] === 'Evet') {
        const graduationDate = member['Mezuniyet'];
        if (graduationDate) {
            const currentJobDate = jobDate || new Date().toISOString().split('T')[0];
            // Eğer iş tarihi mezuniyet tarihinden büyükse (sonraysa), ücret hesaplanır
            if (currentJobDate > graduationDate) {
                // Mezun olmuş, normal hesapla
            } else {
                return 0; // Hala kampta
            }
        } else {
            return 0; // Mezuniyet tarihi yoksa her zaman 0
        }
    }

    // Get latest pricing from state
    const p = state.pricing && state.pricing.length > 0 ? state.pricing[0] : null;

    // Default rates (if pricing sheet is empty)
    const traineeMultiplier = parseFloat(p?.['Acemi Çarpanı'] || 0.5);
    const editorDiscount = parseFloat(p?.['Editör İndirimi'] || 3);

    // 1. CLEANER (Fixed per chapter based on difficulty)
    if (role.includes('Temizlikçi')) {
        let base = 8;
        if (difficulty === 'EN_KOLAY') base = parseFloat(p?.['Temiz EN KOLAY'] || 6);
        else if (difficulty === 'KOLAY') base = parseFloat(p?.['Temiz KOLAY'] || 7);
        else if (difficulty === 'ORTA') base = parseFloat(p?.['Temiz ORTA'] || 8);
        else if (difficulty === 'ZOR') base = parseFloat(p?.['Temiz ZOR'] || 10);
        return Math.round(base); // No trainee multiplier for cleaner as per calculator.py
    }

    // 2. KB BASED ROLES
    let rates = [];
    let multiplier = 1.0;

    if (role === 'Çevirmen') {
        rates = [
            [0, 3, parseFloat(p?.['Çeviri 0-3 KB'] || 20)],
            [3, 6, parseFloat(p?.['Çeviri 3-6 KB'] || 25)],
            [6, 8, parseFloat(p?.['Çeviri 6-8 KB'] || 30)],
            [8, 999, parseFloat(p?.['Çeviri 8+ KB'] || 35)]
        ];
    } else if (role === 'Dizgici') {
        rates = [
            [0, 3, parseFloat(p?.['Dizgi 0-3 KB'] || 10)],
            [3, 6, parseFloat(p?.['Dizgi 3-6 KB'] || 15)],
            [6, 7, parseFloat(p?.['Dizgi 6-7 KB'] || 20)],
            [7, 999, parseFloat(p?.['Dizgi 7+ KB'] || 25)]
        ];
    } else if (role === 'Editör' || role === 'Redaktör') {
        rates = [
            [0, 3, parseFloat(p?.['Çeviri 0-3 KB'] || 20) - editorDiscount],
            [3, 6, parseFloat(p?.['Çeviri 3-6 KB'] || 25) - editorDiscount],
            [6, 8, parseFloat(p?.['Çeviri 6-8 KB'] || 30) - editorDiscount],
            [8, 999, parseFloat(p?.['Çeviri 8+ KB'] || 35) - editorDiscount]
        ];
    } else if (role.includes('Acemi')) {
        if (role.includes('Çevirmen')) {
            multiplier = traineeMultiplier;
            rates = [
                [0, 3, parseFloat(p?.['Çeviri 0-3 KB'] || 20)],
                [3, 6, parseFloat(p?.['Çeviri 3-6 KB'] || 25)],
                [6, 8, parseFloat(p?.['Çeviri 6-8 KB'] || 30)],
                [8, 999, parseFloat(p?.['Çeviri 8+ KB'] || 35)]
            ];
        } else if (role.includes('Dizgici')) {
            multiplier = traineeMultiplier;
            rates = [
                [0, 3, parseFloat(p?.['Dizgi 0-3 KB'] || 10)],
                [3, 6, parseFloat(p?.['Dizgi 3-6 KB'] || 15)],
                [6, 7, parseFloat(p?.['Dizgi 6-7 KB'] || 20)],
                [7, 999, parseFloat(p?.['Dizgi 7+ KB'] || 25)]
            ];
        } else if (role.includes('Redaktör') || role.includes('Editör')) {
            // Acemi Redaktör gets full editor rates
            rates = [
                [0, 3, parseFloat(p?.['Çeviri 0-3 KB'] || 20) - editorDiscount],
                [3, 6, parseFloat(p?.['Çeviri 3-6 KB'] || 25) - editorDiscount],
                [6, 8, parseFloat(p?.['Çeviri 6-8 KB'] || 30) - editorDiscount],
                [8, 999, parseFloat(p?.['Çeviri 8+ KB'] || 35) - editorDiscount]
            ];
        }
    }

    const roundedKb = Math.round(kb);
    let amount = 0;
    for (const [min, max, price] of rates) {
        if (roundedKb > min && roundedKb <= max) {
            amount = price;
            break;
        }
    }

    // If over max defined range
    if (amount === 0 && roundedKb > 0 && rates.length > 0) {
        if (roundedKb > rates[rates.length - 1][1]) {
            amount = rates[rates.length - 1][2];
        }
    }

    return Math.round(amount * multiplier);
}

function showLoading(active) {
    const el = document.getElementById('loading-overlay');
    el.classList.toggle('active', active);
}

function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast.show');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function deleteJob(rowIndex) {
    if (!confirm('Bu işi silmek istediğinize emin misiniz?')) return;

    showLoading(true);
    try {
        const colCount = 11; // ID to Zorluk
        const range = `'${CONFIG.SHEETS.JOBS}'!A${rowIndex}:${String.fromCharCode(64 + colCount)}${rowIndex}`;
        const emptyRow = new Array(colCount).fill('');

        await sheetsUpdate(range, [emptyRow]);

        showToast('İş silindi! ✓', 'success');
        await loadAllData();
    } catch (e) {
        showToast('Silme hatası: ' + e.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ============================================================
// HTML UPLOAD & SYNC LOGIC
// ============================================================
async function handleHTMLUpload(event) {
    showToast('Dosya analiz ediliyor...', 'info');
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;

        // 1. First, try to extract metadata from RAW_DATA script block (it's the most reliable source)
        let email = '';
        let startDate = '';
        let endDate = '';
        let rawFilesFallback = [];

        const rawMatch = content.match(/(?:const|var|let)\s+RAW_DATA\s*=\s*(\{[\s\S]*?\});/);
        if (rawMatch) {
            try {
                const raw = JSON.parse(rawMatch[1]);
                email = raw.worker_email || '';
                startDate = raw.start_date || '';
                endDate = raw.end_date || '';
                rawFilesFallback = raw.files || [];
                console.log('Metadata extracted from RAW_DATA:', { email, startDate, endDate });
            } catch (err) {
                console.warn('Failed to parse RAW_DATA script:', err);
            }
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        // 2. If metadata still missing, try DOM (only works if saved with specific attributes, rare for spans)
        if (!email) email = doc.getElementById('workerName')?.textContent?.trim() || '';
        if (!startDate) {
            const rangeText = doc.getElementById('dateRange')?.textContent?.trim() || '';
            if (rangeText && rangeText.includes(' - ')) {
                [startDate, endDate] = rangeText.split(' - ').map(s => s.trim());
            }
        }

        // Clean up placeholders
        if (email === '-') email = '';
        if (startDate === '-') startDate = '';

        if (!email || !startDate) {
            showToast('HATA: Kullanıcı bilgisi veya tarih aralığı bulunamadı!', 'error');
            return;
        }

        try {
            // 3. Extract rows from table (current visible state)
            const files = [];
            const rows = doc.querySelectorAll('#tableBody tr');

            rows.forEach(row => {
                const dateInput = row.querySelector('td[data-label="Tarih"] input');
                const seriesInput = row.querySelector('td[data-label="Seri"] input');
                const fileInput = row.querySelector('td[data-label="Dosya / Bölüm"] input');
                const roleSelect = row.querySelector('td[data-label="Rol"] select');
                const detailInput = row.querySelector('td[data-label="Detay (KB / Zorluk)"] input, td[data-label="Detay (KB / Zorluk)"] select');

                if (!dateInput && !seriesInput) return; // Skip empty/invalid rows

                const role = roleSelect?.value || '';
                const isCleaner = role.includes('Temizlikçi');

                files.push({
                    date: dateInput?.value || '',
                    series: seriesInput?.value || '',
                    file_name: fileInput?.value || '',
                    role: role,
                    size_kb: !isCleaner ? parseFloat(detailInput?.value || 0) : 0,
                    difficulty: isCleaner ? (detailInput?.value || 'ORTA') : 'ORTA',
                    raw_id: row.getAttribute('data-raw-id') || ''
                });
            });

            // 4. Use RAW_DATA files if table is empty
            const finalFiles = files.length > 0 ? files : rawFilesFallback;

            if (finalFiles.length === 0) {
                showToast('Dosyada aktarılacak iş bulunamadı!', 'warning');
                return;
            }

            if (!confirm(`${email} kullanıcısının ${finalFiles.length} işi senkronize edilsin mi? (Eski verileriniz silinecektir)`)) {
                return;
            }

            const uploadedData = {
                worker_email: email,
                start_date: startDate,
                end_date: endDate,
                files: finalFiles
            };

            await syncUploadedData(uploadedData);
        } catch (err) {
            showToast('Veri işleme hatası: ' + err.message, 'error');
            console.error(err);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function syncUploadedData(uploadedData) {
    showLoading(true);
    try {
        const email = uploadedData.worker_email.toLowerCase();
        const start = uploadedData.start_date;
        const end = uploadedData.end_date;

        console.log(`Syncing for ${email}, range: ${start} to ${end}`);

        // Helper to normalize date strings to YYYY-MM-DD for comparison
        const normalizeDate = (d) => {
            if (!d) return "";
            const str = String(d).trim();
            // If already YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
            // If DD/MM/YYYY or DD.MM.YYYY
            const parts = str.split(/[./-]/);
            if (parts.length === 3) {
                // Handle YYYY-MM-DD or DD-MM-YYYY
                if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
            return str;
        };

        const nStart = normalizeDate(start);
        const nEnd = normalizeDate(end);

        // Get value from object with case-insensitive key
        const getVal = (obj, key) => {
            const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
            return foundKey ? obj[foundKey] : '';
        };

        // 1. Find and clear existing jobs for this user in this range
        // BROAD CLEARING: Clear ALL jobs for this user in the specified date range
        console.log(`Broad clearing for ${email} from ${nStart} to ${nEnd}`);

        const jobsToClear = state.jobs.filter(j => {
            const jEmail = (getVal(j, 'Email') || '').toLowerCase();
            if (jEmail !== email) return false;

            const jDate = normalizeDate(getVal(j, 'Tarih') || '');
            const isInRange = jDate >= nStart && jDate <= nEnd;

            if (isInRange) console.log(`Clearing job at row ${j._rowIndex}: ${getVal(j, 'Seri')} | ${getVal(j, 'Bölüm')} (${jDate})`);
            return isInRange;
        });

        if (jobsToClear.length > 0) {
            showToast(`${jobsToClear.length} eski iş temizleniyor...`, 'info');
            const promises = jobsToClear.map(j => {
                const range = `'${CONFIG.SHEETS.JOBS}'!A${j._rowIndex}:K${j._rowIndex}`;
                const emptyRow = new Array(11).fill('');
                return sheetsUpdate(range, [emptyRow]);
            });
            await Promise.all(promises);
            console.log(`Successfully cleared ${jobsToClear.length} rows.`);
        } else {
            console.log("No jobs found to clear for this user in this date range.");
            showToast('Temizlenecek eski iş bulunamadı.', 'info');
        }

        // 2. Prepare new rows
        const newRows = uploadedData.files.map(f => [
            'NEW',
            f.date,
            f.series,
            f.file_name,
            f.raw_id || '', // Dosya/Link
            f.role,
            f.size_kb,
            calculateJobPrice(f.role, f.size_kb, f.difficulty || 'ORTA', email, f.date),
            state.members.find(m => m['Email'].toLowerCase() === email)?.['İsim'] || email,
            email,
            f.difficulty || 'ORTA'
        ]);

        // 3. Append new jobs
        if (newRows.length > 0) {
            await sheetsAppend(`'${CONFIG.SHEETS.JOBS}'!A2`, newRows);
            console.log(`Appended ${newRows.length} new rows.`);
        }

        showToast(`${newRows.length} iş başarıyla aktarıldı. ✨`, 'success');

        // 4. Auto Update Related Jobs (KB Sync)
        await autoUpdateRelatedJobs(uploadedData.files);

        await loadAllData();
    } catch (err) {
        showToast('Senkronizasyon hatası: ' + err.message, 'error');
        console.error(err);
    } finally {
        showLoading(false);
    }
}

async function autoUpdateRelatedJobs(uploadedFiles) {
    const translatorJobs = uploadedFiles.filter(f => f.role.includes('Çevirmen'));
    if (translatorJobs.length === 0) return;

    showToast('İlişkili işler taranıyor (KB Senkronizasyonu)...', 'info');

    // Refresh local state to get the latest before cross-referencing
    await loadAllData();

    const updates = [];
    translatorJobs.forEach(tJob => {
        const kb = parseFloat(tJob.size_kb);
        if (isNaN(kb) || kb <= 0) return;

        // Find jobs in same series/chapter that are NOT translators
        const related = state.jobs.filter(j =>
            j['Seri'] === tJob.series &&
            j['Bölüm'] === tJob.file_name &&
            !j['Rol'].includes('Çevirmen') &&
            parseFloat(j['Ref KB'] || 0) === 0 // Only update if KB was missing/zero
        );

        related.forEach(rj => {
            const newPrice = calculateJobPrice(rj['Rol'], kb, rj['Zorluk'] || 'ORTA', rj['Email'], rj['Tarih']);

            // Collect updates
            const kbCol = getColumnIndex(CONFIG.SHEETS.JOBS, 'Ref KB');
            const priceCol = getColumnIndex(CONFIG.SHEETS.JOBS, 'Ücret (TL)');

            updates.push({
                range: `'${CONFIG.SHEETS.JOBS}'!${String.fromCharCode(64 + kbCol)}${rj._rowIndex}`,
                values: [[kb]]
            });
            updates.push({
                range: `'${CONFIG.SHEETS.JOBS}'!${String.fromCharCode(64 + priceCol)}${rj._rowIndex}`,
                values: [[newPrice]]
            });
        });
    });

    if (updates.length > 0) {
        showToast(`${updates.length / 2} ilişkili iş güncelleniyor...`, 'info');
        const promises = updates.map(u => sheetsUpdate(u.range, u.values));
        await Promise.all(promises);
        showToast('KB senkronizasyonu tamamlandı. ✓', 'success');
    }
}

// Global scope expose for event handlers
window.handleHTMLUpload = handleHTMLUpload;
