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
    SPREADSHEET_ID: '11zDw2n4rE8SYOUrQdhNdj7_Y2FkPUJNuCegz9kuXygk',

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
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${state.accessToken}` }
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Sheets API hatası');
    }
    const data = await res.json();
    return data.values || [];
}

async function sheetsUpdate(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${state.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Güncelleme hatası');
    }
    return await res.json();
}

async function sheetsAppend(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${state.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Ekleme hatası');
    }
    return await res.json();
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
    return rows.map((row, idx) => {
        const obj = { _rowIndex: idx + 2 };
        headers.forEach((h, i) => {
            obj[h] = row[i] || '';
        });
        return obj;
    });
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
                html += `<tr><td colspan="${columns.length}" style="background:rgba(79,140,255,0.08);padding:8px 16px;font-weight:700;color:var(--accent-blue);border-left:3px solid var(--accent-blue);">📚 ${escapeHtml(currentSeries)}</td></tr>`;
                lastSeries = currentSeries;
            }
            html += '<tr>';
            columns.forEach(col => {
                const val = job[col] || '';
                const isEditable = editableCols.includes(col);
                const colIndex = getColumnIndex(CONFIG.SHEETS.JOBS, col);

                // Üye kamp durumunu kontrol et
                const jobMember = state.members.find(m => (m['Email'] || '').toLowerCase() === (job['Email'] || '').toLowerCase());
                const isOnCamp = jobMember && jobMember['Kamp'] === 'Evet';

                if (col === 'Dosya') {
                    if (val && val.startsWith('http')) {
                        html += `<td data-label="${col}"><a href="${val}" target="_blank" style="color:var(--accent-blue);font-weight:600;text-decoration:none;">📄 DOSYA</a></td>`;
                    } else {
                        html += `<td data-label="${col}" style="color:var(--text-muted);">—</td>`;
                    }
                } else if (col === 'Rol') {
                    let cellVal = getRoleBadge(val);
                    if (isOnCamp) cellVal += ' <span class="role-badge kamp" style="font-size:0.6rem;padding:1px 4px;">KAMP</span>';
                    html += `<td data-label="${col}" class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.JOBS}', ${job._rowIndex}, ${colIndex}, '${col}')"` : ''}>${cellVal}</td>`;
                } else if (col === 'Ücret (TL)') {
                    const displayAmt = isOnCamp ? '0' : parseFloat(val || 0).toFixed(0);
                    html += `<td data-label="${col}" class="amount ${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.JOBS}', ${job._rowIndex}, ${colIndex}, '${col}')"` : ''} style="${isOnCamp ? 'color:var(--accent-red);opacity:0.6;' : ''}">${displayAmt} TL</td>`;
                } else {
                    html += `<td data-label="${col}" class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.JOBS}', ${job._rowIndex}, ${colIndex}, '${col}')"` : ''}>${escapeHtml(val)}</td>`;
                }
            });
            if (state.isAdmin) {
                html += `
                <td style="text-align:center">
                    <button class="btn-action secondary" 
                            style="padding: 4px 8px; color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);"
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

    const columns = ['ID', 'İsim', 'Email', 'Rol', 'Aktif', 'Karaliste', 'Admin', 'Kamp', 'Toplam Kazanç'];
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
                const total = state.jobs
                    .filter(j => (j['Email'] || '').toLowerCase() === (member['Email'] || '').toLowerCase())
                    .reduce((sum, j) => sum + parseFloat(j['Ücret (TL)'] || 0), 0);
                html += `<td data-label="${col}" style="font-weight:800; color:var(--accent-green);">${Math.round(total)} TL</td>`;
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
    if (isBooleanCol || isDifficultyCol) {
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

        // Find difficulty from series
        const s = state.series.find(x => x['Seri Adı'] === series);
        const difficulty = s ? s['Zorluk'] : 'ORTA';

        // Row format: ID(new), Tarih, Seri, Bölüm, Dosya, Rol, Ref KB, Ücret, Üye Adı, Email, Zorluk
        // We leave ID empty or let Sheet generate? actually IDs are managed by the pull script.
        // We can use 0 or something for "NEW" jobs to be assigned later by backend.
        const newRow = [
            'NEW',
            today,
            series,
            chapter,
            file,
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

    const price = calculateJobPrice(role, kb, difficulty, email);

    const estimateEl = document.getElementById('add-job-price-estimate');
    if (kb > 0 || role.includes('Temiz')) {
        estimateEl.style.display = 'block';
        estimateEl.querySelector('.value').textContent = price + ' TL';
    } else {
        estimateEl.style.display = 'none';
    }
}

function calculateJobPrice(role, kb, difficulty = 'ORTA', targetEmail = null) {
    // Check if user is on camp (from state.members)
    const emailToCheck = (targetEmail || state.user?.email || '').toLowerCase();
    const member = state.members.find(m => (m['Email'] || '').toLowerCase() === emailToCheck);
    if (member && member['Kamp'] === 'Evet') return 0;

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
