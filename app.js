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
            sheetsGet(`'${CONFIG.SHEETS.JOBS}'!A1:K10000`),
            sheetsGet(`'${CONFIG.SHEETS.MEMBERS}'!A1:G10000`),
            sheetsGet(`'${CONFIG.SHEETS.SERIES}'!A1:C10000`),
            sheetsGet(`'${CONFIG.SHEETS.PRICING}'!A1:O10000`)
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
    state.isAdmin = member && (member['Admin'] === 'Evet');

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

    // Email Filtering — Admin olmayanlar sadece kendisininkini görsün
    if (!state.isAdmin) {
        const email = state.user.email.toLowerCase();
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
    const columns = ['Tarih', 'Seri', 'Bölüm', 'Dosya', 'Rol', 'Ref KB', 'Ücret (TL)', 'Üye Adı', 'Email', 'Zorluk'];

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

                if (col === 'Dosya') {
                    if (val && val.startsWith('http')) {
                        html += `<td><a href="${val}" target="_blank" style="color:var(--accent-blue);font-weight:600;text-decoration:none;">📄 DOSYA</a></td>`;
                    } else {
                        html += `<td style="color:var(--text-muted);">—</td>`;
                    }
                } else if (col === 'Rol') {
                    html += `<td class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.JOBS}', ${job._rowIndex}, ${colIndex})"` : ''}>${getRoleBadge(val)}</td>`;
                } else if (col === 'Ücret (TL)') {
                    html += `<td class="amount ${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.JOBS}', ${job._rowIndex}, ${colIndex})"` : ''}>${parseFloat(val || 0).toFixed(0)} TL</td>`;
                } else {
                    html += `<td class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.JOBS}', ${job._rowIndex}, ${colIndex})"` : ''}>${escapeHtml(val)}</td>`;
                }
            });
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

    const columns = ['ID', 'İsim', 'Email', 'Rol', 'Aktif', 'Karaliste', 'Admin'];
    const editableCols = ['İsim', 'Email', 'Rol', 'Aktif', 'Karaliste', 'Admin'];

    renderToolbar(false);

    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(col => html += `<th>${col}</th>`);
    html += '</tr></thead><tbody>';

    data.forEach(member => {
        html += '<tr>';
        columns.forEach(col => {
            const val = member[col] || '';
            const isEditable = editableCols.includes(col);
            const colIndex = getColumnIndex(CONFIG.SHEETS.MEMBERS, col);

            if (col === 'Rol') {
                html += `<td class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.MEMBERS}', ${member._rowIndex}, ${colIndex})"` : ''}>${getRoleBadge(val)}</td>`;
            } else {
                html += `<td class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.MEMBERS}', ${member._rowIndex}, ${colIndex})"` : ''}>${escapeHtml(val)}</td>`;
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

    const columns = ['ID', 'Seri Adı', 'Zorluk'];
    const editableCols = ['Seri Adı', 'Zorluk'];

    renderToolbar(false);

    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(col => html += `<th>${col}</th>`);
    html += '</tr></thead><tbody>';

    data.forEach(series => {
        html += '<tr>';
        columns.forEach(col => {
            const val = series[col] || '';
            const isEditable = editableCols.includes(col);
            const colIndex = getColumnIndex(CONFIG.SHEETS.SERIES, col);
            html += `<td class="${isEditable ? 'editable' : ''}" ${isEditable ? `ondblclick="startEdit(this, '${CONFIG.SHEETS.SERIES}', ${series._rowIndex}, ${colIndex})"` : ''}>${escapeHtml(val)}</td>`;
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
            html += `<td class="editable" ondblclick="startEdit(this, '${CONFIG.SHEETS.PRICING}', ${p._rowIndex}, ${colIndex})">${escapeHtml(val)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// TOOLBAR
// ============================================================
function renderToolbar(showRoleFilter) {
    const toolbarEl = document.getElementById('toolbar');

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
    }

    html += `<button class="btn-action primary" onclick="openAddJobModal()">✨ Yeni İş Ekle</button>`;
    html += `<button class="btn-action secondary" onclick="loadAllData()">🔄 Yenile</button>`;

    toolbarEl.innerHTML = html;
}

// ============================================================
// INLINE EDITING
// ============================================================
function startEdit(cell, sheetName, rowIndex, colIndex) {
    if (cell.querySelector('input')) return;

    const currentValue = cell.textContent.replace(' TL', '').trim();
    const originalHTML = cell.innerHTML;

    const input = document.createElement('input');
    input.className = 'inline-edit';
    input.value = currentValue;

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            await saveEdit(cell, sheetName, rowIndex, colIndex, input.value, originalHTML);
        } else if (e.key === 'Escape') {
            cell.innerHTML = originalHTML;
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (cell.querySelector('input')) {
                cell.innerHTML = originalHTML;
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
    document.getElementById('add-job-file').value = '';

    // Member's default role
    const member = state.members.find(m => (m['Email'] || '').toLowerCase() === (state.user?.email || '').toLowerCase());
    if (member && member['Rol']) {
        document.getElementById('add-job-role').value = member['Rol'];
    }

    document.getElementById('add-job-modal').classList.add('active');
}

function closeAddJobModal() {
    document.getElementById('add-job-modal').classList.remove('active');
}

async function submitAddJob() {
    const series = document.getElementById('add-job-series').value;
    const chapter = document.getElementById('add-job-chapter').value;
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
        const memberEmail = state.user?.email || '';

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
            role,
            0, // Ref KB
            0, // Ücret (backend calculates)
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
            'ID': 1, 'İsim': 2, 'Email': 3, 'Rol': 4, 'Aktif': 5, 'Karaliste': 6, 'Admin': 7
        },
        [CONFIG.SHEETS.SERIES]: {
            'ID': 1, 'Seri Adı': 2, 'Zorluk': 3
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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
