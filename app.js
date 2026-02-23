/**
 * Ödeme Takip - Ekip Paneli
 * Google Sheets API ile veri okuma/düzenleme
 * Google Identity Services ile kimlik doğrulama
 */

// ============================================================
// CONFIG — Bu değerleri kendi projenizden alın
// ============================================================
const CONFIG = {
    // Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client ID (Web)
    CLIENT_ID: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',

    // Google Sheets API Scope
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

    // Spreadsheet ID — sheets_sync.py tarafından oluşturulur
    SPREADSHEET_ID: '',

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
            onSignedIn();
        }
    });
}

function handleSignIn() {
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes('YOUR_CLIENT_ID')) {
        showToast('Lütfen CONFIG.CLIENT_ID değerini ayarlayın!', 'error');
        return;
    }
    state.tokenClient.requestAccessToken();
}

function handleSignOut() {
    if (state.accessToken) {
        google.accounts.oauth2.revoke(state.accessToken, () => {
            state.accessToken = null;
            state.user = null;
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('app-screen').style.display = 'none';
        });
    }
}

async function onSignedIn() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${state.accessToken}` }
        });
        state.user = await res.json();
    } catch (e) {
        state.user = { name: 'Kullanıcı', picture: '' };
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

async function loadAllData() {
    showLoading(true);
    try {
        if (!CONFIG.SPREADSHEET_ID) {
            showLoading(false);
            showToast('SPREADSHEET_ID ayarlanmamış! app.js içindeki CONFIG.SPREADSHEET_ID değerini güncelleyin.', 'error');
            return;
        }

        const [jobsRaw, membersRaw, seriesRaw, pricingRaw] = await Promise.all([
            sheetsGet(`'${CONFIG.SHEETS.JOBS}'!A1:J10000`),
            sheetsGet(`'${CONFIG.SHEETS.MEMBERS}'!A1:F10000`),
            sheetsGet(`'${CONFIG.SHEETS.SERIES}'!A1:C10000`),
            sheetsGet(`'${CONFIG.SHEETS.PRICING}'!A1:O10000`)
        ]);

        state.jobs = parseSheetData(jobsRaw);
        state.members = parseSheetData(membersRaw);
        state.series = parseSheetData(seriesRaw);
        state.pricing = parseSheetData(pricingRaw);

        updateStats();
        renderActiveTab();

        showToast(`${state.jobs.length} iş, ${state.members.length} üye yüklendi`, 'success');
    } catch (e) {
        showToast('Veri yükleme hatası: ' + e.message, 'error');
        console.error(e);
    } finally {
        showLoading(false);
    }
}

function parseSheetData(rawValues) {
    if (!rawValues || rawValues.length < 2) return [];
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

// ============================================================
// STATS
// ============================================================
function updateStats() {
    const totalJobs = state.jobs.length;
    const totalMembers = state.members.length;
    const totalAmount = state.jobs.reduce((sum, j) => sum + parseFloat(j['Ücret (TL)'] || 0), 0);
    const totalSeries = state.series.length;

    document.getElementById('stat-jobs').textContent = totalJobs;
    document.getElementById('stat-members').textContent = totalMembers;
    document.getElementById('stat-amount').textContent = totalAmount.toFixed(0) + ' TL';
    document.getElementById('stat-series').textContent = totalSeries;
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
// RENDER JOBS — seriye göre gruplu, drive linki ile
// ============================================================
function renderJobs() {
    let data = [...state.jobs];

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
            if (currentSeries !== lastSeries && currentSeries) {
                html += `<tr><td colspan="${columns.length}" style="background:rgba(79,140,255,0.08);padding:8px 16px;font-weight:700;color:var(--accent-blue);border-left:3px solid var(--accent-blue);">📚 ${escapeHtml(currentSeries)}</td></tr>`;
                lastSeries = currentSeries;
            }
            html += '<tr>';
            columns.forEach(col => {
                const val = job[col] || '';
                const isEditable = editableCols.includes(col);
                const colIndex = getColumnIndex(CONFIG.SHEETS.JOBS, col);

                if (col === 'Dosya') {
                    const fileId = extractFileId(val);
                    if (fileId) {
                        html += `<td><a href="https://drive.google.com/file/d/${fileId}/view" target="_blank" style="color:var(--accent-blue);font-weight:600;text-decoration:none;">📄 DOSYA</a></td>`;
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

function extractFileId(cellValue) {
    if (!cellValue) return null;
    const match = cellValue.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    return null;
}

// ============================================================
// RENDER MEMBERS
// ============================================================
function renderMembers() {
    let data = [...state.members];

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        data = data.filter(m =>
            (m['İsim'] || '').toLowerCase().includes(q) ||
            (m['Email'] || '').toLowerCase().includes(q) ||
            (m['Rol'] || '').toLowerCase().includes(q)
        );
    }

    const columns = ['ID', 'İsim', 'Email', 'Rol', 'Aktif', 'Karaliste'];
    const editableCols = ['İsim', 'Email', 'Rol', 'Aktif', 'Karaliste'];

    renderToolbar(false);

    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(col => html += `<th>${col}</th>`);
    html += '</tr></thead><tbody>';

    if (data.length === 0) {
        html += `<tr><td colspan="${columns.length}"><div class="empty-state"><div class="icon">👥</div><h3>Üye bulunamadı</h3></div></td></tr>`;
    } else {
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
    }

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// RENDER SERIES
// ============================================================
function renderSeries() {
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

    if (data.length === 0) {
        html += `<tr><td colspan="${columns.length}"><div class="empty-state"><div class="icon">📚</div><h3>Seri bulunamadı</h3></div></td></tr>`;
    } else {
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
    }

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

// ============================================================
// RENDER PRICING — düz sütunlar, hepsi düzenlenebilir
// ============================================================
function renderPricing() {
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

    if (data.length === 0) {
        html += `<tr><td colspan="${columns.length}"><div class="empty-state"><div class="icon">💰</div><h3>Fiyatlandırma verisi yok</h3></div></td></tr>`;
    } else {
        data.forEach(p => {
            html += '<tr>';
            columns.forEach(col => {
                const val = p[col] || '';
                const colIndex = getColumnIndex(CONFIG.SHEETS.PRICING, col);
                html += `<td class="editable" ondblclick="startEdit(this, '${CONFIG.SHEETS.PRICING}', ${p._rowIndex}, ${colIndex})">${escapeHtml(val)}</td>`;
            });
            html += '</tr>';
        });
    }

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

    html += `<button class="btn-action primary" onclick="loadAllData()">🔄 Yenile</button>`;

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
// COLUMN INDEX MAPPING
// ============================================================
function getColumnIndex(sheetName, columnName) {
    const columnMaps = {
        [CONFIG.SHEETS.JOBS]: {
            'Tarih': 1, 'Seri': 2, 'Bölüm': 3, 'Dosya': 4,
            'Rol': 5, 'Ref KB': 6, 'Ücret (TL)': 7, 'Üye Adı': 8,
            'Email': 9, 'Zorluk': 10
        },
        [CONFIG.SHEETS.MEMBERS]: {
            'ID': 1, 'İsim': 2, 'Email': 3, 'Rol': 4, 'Aktif': 5, 'Karaliste': 6
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
