// app.js

let conditionChartInstance = null;
let physicalChartInstance = null;
let currentActivePlayerId = 'team'; // 'team' or player name string
let currentSort = { col: null, asc: true };
let currentMetricFilter = 'all';

let appSettings = {
    sheetUrl: '',
    autoSync: false,
    lastSync: null
};

function loadSettings() {
    const saved = localStorage.getItem('lacrosse_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appSettings = Object.assign(appSettings, parsed);
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }
}

function saveSettings() {
    let url = document.getElementById('sheet-url').value.trim();
    const auto = document.getElementById('auto-sync').checked;
    
    // Googleスプレッドシートの通常URLをCSVエクスポート用URLに自動変換
    if (url.includes('docs.google.com/spreadsheets/d/')) {
        if (url.includes('/edit')) {
            const baseUrl = url.split('/edit')[0];
            const params = new URLSearchParams(url.split('?')[1] || '');
            const gid = params.get('gid');
            url = `${baseUrl}/pub?output=csv${gid ? '&gid=' + gid : ''}`;
        } else if (!url.includes('/pub')) {
            // 末尾に/pubがなければ追加
            url = url.replace(/\/+$/, '') + '/pub?output=csv';
        }
    }
    
    appSettings.sheetUrl = url;
    appSettings.autoSync = auto;
    
    localStorage.setItem('lacrosse_settings', JSON.stringify(appSettings));
    closeSettings();
    
    if (url) {
        syncDataFromUrl(url);
    }
}

function openSettings() {
    document.getElementById('sheet-url').value = appSettings.sheetUrl || '';
    document.getElementById('auto-sync').checked = appSettings.autoSync || false;
    document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

async function syncDataFromUrl(url) {
    if (!url) return;
    
    updateSyncStatus('syncing', '同期中...');
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('ネットワークエラーが発生しました');
        
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, {type: 'array'});
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet);
        
        processConditionData(rows, true); // true for silent
        
        appSettings.lastSync = new Date().toISOString();
        localStorage.setItem('lacrosse_settings', JSON.stringify(appSettings));
        
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        updateSyncStatus('success', `同期完了 (${timeStr})`);
    } catch (e) {
        console.error("Sync failed", e);
        if (window.location.protocol === 'file:') {
            updateSyncStatus('error', '同期失敗 (ブラウザ制限)');
            alert('【同期失敗の原因】\nブラウザのセキュリティ制限により、ファイルを直接開いている状態(file://)では外部データの取得ができません。\n\nVS Codeの「Live Server」を使用するか、GitHub Pagesなどにアップロードして運用してください。\n※ローカルファイルのまま使用する場合は「手動読込」ボタンをお使いください。');
        } else {
            updateSyncStatus('error', '同期失敗');
        }
    }
}

function updateSyncStatus(state, message) {
    const container = document.getElementById('sync-status');
    if (!container) return;
    
    let icon = 'ph ph-cloud-check';
    if (state === 'syncing') icon = 'ph ph-arrows-clockwise';
    if (state === 'error') icon = 'ph ph-cloud-warning';
    
    container.className = `sync-status ${state}`;
    container.innerHTML = `<i class="${icon}"></i> <span>${message}</span>`;
}

function saveData() {
    localStorage.setItem('lacrosse_mockData', JSON.stringify(mockData));
}

function loadData() {
    const saved = localStorage.getItem('lacrosse_mockData');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Replace mockData properties
            Object.assign(mockData, parsed);
        } catch (e) {
            console.error("Failed to parse saved data", e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    loadSettings();

    // Initial Render
    renderTabs();
    populateDateFilter();
    populatePlayersTable();
    initCharts();
    updateDashboardForTeam();
    initSort();

    // File Input Listeners
    const conditionInput = document.getElementById('file-condition');
    if (conditionInput) {
        conditionInput.addEventListener('change', handleConditionUpload);
    }

    // Date filter listener
    const dateFilter = document.getElementById('table-date-filter');
    if (dateFilter) {
        dateFilter.addEventListener('change', () => {
            populatePlayersTable();
        });
    }

    // Auto Sync
    if (appSettings.autoSync && appSettings.sheetUrl) {
        syncDataFromUrl(appSettings.sheetUrl);
    } else if (appSettings.lastSync) {
        const time = new Date(appSettings.lastSync);
        const timeStr = time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        updateSyncStatus('success', `最終同期: ${timeStr}`);
    }
});

function populateDateFilter() {
    const select = document.getElementById('table-date-filter');
    if (!select || !mockData.dates) return;
    
    // Keep the first placeholder option
    select.innerHTML = '<option value="">-- 日付を選択 --</option>';
    
    // Add dates in reverse order (newest first)
    const reversed = [...mockData.dates].reverse();
    reversed.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        select.appendChild(opt);
    });
    
    // Default to latest date
    if (mockData.dates.length > 0) {
        select.value = mockData.dates[mockData.dates.length - 1];
    }
}

function renderTabs() {
    const tabsList = document.getElementById('player-tabs-list');
    tabsList.innerHTML = ''; // clear

    mockData.players.forEach(player => {
        const btn = document.createElement('button');
        btn.className = 'player-tab';
        btn.textContent = player.name;
        btn.dataset.playerId = player.name;
        
        btn.addEventListener('click', () => {
            document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            currentActivePlayerId = player.name;
            updateDashboardForPlayer(player.name);
        });
        
        tabsList.appendChild(btn);
    });

    // Team Average Tab click
    const teamTab = document.querySelector('.player-tab[data-player-id="team"]');
    teamTab.onclick = () => {
        document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('active'));
        teamTab.classList.add('active');
        currentActivePlayerId = 'team';
        updateDashboardForTeam();
    };
}

function handleConditionUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet);
        
        processConditionData(rows);
    };
    reader.readAsArrayBuffer(file);
}

function processConditionData(rows, silent = false) {
    // Keys based on user input
    const nameKey = "名前(コートネーム)";
    const dateKey = "タイムスタンプ";
    // ヘッダー名が完全一致しなくても対応できるように、includesでの判定を優先します

    let playersMap = {}; // name -> player data
    let records = [];
    
    // 既存の選手名も正規化して統合の準備をする
    mockData.players.forEach(p => {
        let normalizedName = String(p.name).replace(/\d+/g, '').trim();
        if (playersMap[normalizedName]) {
            // すでに存在する場合は（理論上ありえないが念のため）統合を試みるか、既存を優先
            // ここでは既存のオブジェクトを再利用
        } else {
            p.name = normalizedName;
            playersMap[normalizedName] = p;
        }
    });

    // Reset condition trends
    Object.values(playersMap).forEach(p => {
        p.conditionTrend = { fatigue: [], sleep: [] };
        p.dates = [];
    });

    rows.forEach(row => {
        let rawName = row[nameKey];
        if (!rawName) return; 
        
        // 名前から数字を除去して正規化（例：「氏名1」→「氏名」）
        let name = String(rawName).replace(/\d+/g, '').trim();
        if (!name) return; 
        
        let rawDate = row[dateKey];
        let dateStr = "";
        let year = new Date().getFullYear();
        let month = 0, day = 0;
        
        if (typeof rawDate === 'number') {
            let jsDate = new Date((rawDate - 25569) * 86400 * 1000);
            year = jsDate.getFullYear();
            month = jsDate.getMonth() + 1;
            day = jsDate.getDate();
            dateStr = `${year}/${month}/${day}`;
        } else if (typeof rawDate === 'string') {
            let matchYMD = rawDate.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
            if (matchYMD) {
                year = parseInt(matchYMD[1]);
                month = parseInt(matchYMD[2]);
                day = parseInt(matchYMD[3]);
                dateStr = `${year}/${month}/${day}`;
            } else {
                let matchMD = rawDate.match(/(\d{1,2})[-\/](\d{1,2})/);
                if (matchMD) {
                    month = parseInt(matchMD[1]);
                    day = parseInt(matchMD[2]);
                    dateStr = `${year}/${month}/${day}`; // Assume current year if missing
                }
            }
        }
        
        if (!dateStr) return; // invalid date

        let fatigue = 3;
        let sleep = 7;

        let details = { temp: null, hr: null, weight: null, bodyFat: null, sleepQuality: null, activity: null, painStatus: "", painDesc: "", menstrualDate: null };
        
        for (let k in row) {
            if (k.includes('疲労度')) fatigue = parseFloat(row[k]) || fatigue;
            if (k.includes('睡眠時間')) sleep = parseFloat(row[k]) || sleep;
            
            if (k.includes('体温')) details.temp = parseFloat(row[k]) || null;
            if (k.includes('心拍数')) details.hr = parseFloat(row[k]) || null;
            if (k.includes('体重')) details.weight = parseFloat(row[k]) || null;
            if (k.includes('体脂肪率')) details.bodyFat = parseFloat(row[k]) || null;
            if (k.includes('痛み、張り感の有無')) details.painStatus = String(row[k]);
            if (k.includes('部位・症状・程度')) details.painDesc = String(row[k]);
            if (k.includes('睡眠の質')) details.sleepQuality = String(row[k]);
            if (k.includes('活動')) details.activity = parseFloat(row[k]) || null;
            // 月経開始日の抽出
            if (k.includes('月経')) {
                let mVal = row[k];
                if (mVal) {
                    if (typeof mVal === 'number') {
                        // Excelシリアル日付
                        let mDate = new Date((mVal - 25569) * 86400 * 1000);
                        details.menstrualDate = mDate.toISOString().split('T')[0];
                    } else if (typeof mVal === 'string' && mVal.trim() !== '' && mVal.trim() !== '--' && mVal.trim() !== 'なし') {
                        // 文字列日付をパース (YYYY/MM/DD, YYYY-MM-DD, MM/DD 等)
                        let mMatch = mVal.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
                        if (mMatch) {
                            details.menstrualDate = `${mMatch[1]}-${mMatch[2].padStart(2,'0')}-${mMatch[3].padStart(2,'0')}`;
                        } else {
                            let mMatch2 = mVal.match(/(\d{1,2})[-\/](\d{1,2})/);
                            if (mMatch2) {
                                details.menstrualDate = `${year}-${mMatch2[1].padStart(2,'0')}-${mMatch2[2].padStart(2,'0')}`;
                            }
                        }
                    }
                }
            }
        }

        // 10段階評価の場合は5段階に変換 (例: 10 -> 5, 8 -> 4, 6 -> 3)
        if (fatigue > 5) {
            fatigue = fatigue / 2;
        }

        if (!playersMap[name]) {
            playersMap[name] = {
                id: Object.keys(playersMap).length + 1,
                name: name,
                position: "不明",
                currentFatigue: fatigue,
                currentSleep: sleep,
                currentStress: 3,
                conditionTrend: { fatigue: [], sleep: [] },
                detailsHistory: [],
                dates: [],
                currentDetails: {}
            };
        }

        records.push({ name, dateStr, year, month, day, fatigue, sleep, details });
    });

    // Extract unique dates and sort them chronologically by year, month, day
    let uniqueDatesMap = {};
    records.forEach(r => {
        uniqueDatesMap[r.dateStr] = { year: r.year, month: r.month, day: r.day };
    });
    let sortedDatesObj = Object.keys(uniqueDatesMap).map(d => ({ dateStr: d, ...uniqueDatesMap[d] }));
    sortedDatesObj.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.month !== b.month) return a.month - b.month;
        return a.day - b.day;
    });

    // Display dates on graph as YYYY/MM/DD to prevent ambiguity across years
    let sortedDates = sortedDatesObj.map(d => d.dateStr);
    mockData.dates = sortedDates;

    // Initialize arrays for each player
    Object.values(playersMap).forEach(p => {
        p.dates = sortedDates;
        p.conditionTrend.fatigue = new Array(sortedDates.length).fill(null);
        p.conditionTrend.sleep = new Array(sortedDates.length).fill(null);
        p.detailsHistory = new Array(sortedDates.length).fill(null);
    });

    // Populate data aligned to sorted dates
    records.forEach(r => {
        let p = playersMap[r.name];
        let idx = sortedDates.indexOf(r.dateStr);
        if (idx !== -1) {
            p.conditionTrend.fatigue[idx] = r.fatigue;
            p.conditionTrend.sleep[idx] = r.sleep;
            p.detailsHistory[idx] = r.details;
            p.currentFatigue = r.fatigue; 
            p.currentSleep = r.sleep;
            p.currentDetails = r.details;
        }
    });
    
    // Ensure currentFatigue/Sleep is the latest chronological data point
    // Also track latest menstrual start date per player
    Object.values(playersMap).forEach(p => {
        let latestMenstrualDate = null;
        for (let i = sortedDates.length - 1; i >= 0; i--) {
            if (p.conditionTrend.fatigue[i] !== null) {
                if (!p.currentFatigue || i === sortedDates.length - 1 || p.conditionTrend.fatigue[i] !== null) {
                    p.currentFatigue = p.conditionTrend.fatigue[i];
                    p.currentSleep = p.conditionTrend.sleep[i];
                    p.currentDetails = p.detailsHistory[i] || {};
                }
            }
            // 直近の月経開始日を探す (最新から遡る)
            if (!latestMenstrualDate && p.detailsHistory[i] && p.detailsHistory[i].menstrualDate) {
                latestMenstrualDate = p.detailsHistory[i].menstrualDate;
            }
        }
        // 最新の疲労度を確定
        for (let i = sortedDates.length - 1; i >= 0; i--) {
            if (p.conditionTrend.fatigue[i] !== null) {
                p.currentFatigue = p.conditionTrend.fatigue[i];
                p.currentSleep = p.conditionTrend.sleep[i];
                p.currentDetails = p.detailsHistory[i] || {};
                break;
            }
        }
        p.latestMenstrualDate = latestMenstrualDate;
    });

    mockData.players = Object.values(playersMap);

    // Calculate Team Averages (Overall current)
    let totalFatigue = 0, totalSleep = 0, count = 0;
    mockData.players.forEach(p => {
        if(p.currentFatigue !== null && p.currentFatigue !== undefined) { 
            totalFatigue += p.currentFatigue; 
            totalSleep += p.currentSleep;
            count++; 
        }
    });

    mockData.team.avgFatigue = count > 0 ? totalFatigue / count : 0;
    mockData.team.avgSleep = count > 0 ? totalSleep / count : 0;
    console.log('Loaded records:', rows.length);

    // Build team trend properly aligned
    mockData.teamConditionTrend = { fatigue: [], sleep: [] };
    mockData.dates.forEach((d, idx) => {
        let fSum = 0, sSum = 0, c = 0;
        mockData.players.forEach(p => {
            if(p.conditionTrend.fatigue[idx] !== null) {
                fSum += p.conditionTrend.fatigue[idx];
                sSum += p.conditionTrend.sleep[idx];
                c++;
            }
        });
        mockData.teamConditionTrend.fatigue.push(c > 0 ? fSum/c : null);
        mockData.teamConditionTrend.sleep.push(c > 0 ? sSum/c : null);
    });

    // Save to LocalStorage
    saveData();

    // Refresh UI
    renderTabs();
    populateDateFilter();
    populatePlayersTable();
    
    if (currentActivePlayerId === 'team') {
        updateDashboardForTeam();
    } else {
        updateDashboardForPlayer(currentActivePlayerId);
    }
    if (!silent) {
        alert('コンディションデータの読み込みと保存が完了しました！\n次回以降は再読み込み（リロード）してもデータが維持されます。');
    }
}


function populatePlayersTable() {
    const tbody = document.getElementById('players-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Determine selected date index
    const dateFilter = document.getElementById('table-date-filter');
    const selectedDate = dateFilter ? dateFilter.value : '';
    let dateIndex = -1;
    if (selectedDate && mockData.dates) {
        dateIndex = mockData.dates.indexOf(selectedDate);
    }
    // If no date selected or not found, default to latest
    if (dateIndex < 0 && mockData.dates && mockData.dates.length > 0) {
        dateIndex = mockData.dates.length - 1;
    }

    // Filter: only players with data on the selected date
    let targetPlayers = mockData.players;
    if (dateIndex >= 0) {
        targetPlayers = mockData.players.filter(p => 
            p.conditionTrend && 
            p.conditionTrend.fatigue[dateIndex] !== null && 
            p.conditionTrend.fatigue[dateIndex] !== undefined
        );
    }

    targetPlayers.forEach(player => {
        const tr = document.createElement('tr');
        
        // Use the data at the selected date index, not currentDetails
        const fatigue = (dateIndex >= 0 && player.conditionTrend) ? player.conditionTrend.fatigue[dateIndex] : player.currentFatigue;
        const sleep = (dateIndex >= 0 && player.conditionTrend) ? player.conditionTrend.sleep[dateIndex] : player.currentSleep;
        const details = (dateIndex >= 0 && player.detailsHistory) ? (player.detailsHistory[dateIndex] || {}) : (player.currentDetails || {});

        const painStatus = details.painStatus || "なし";
        const hasPain = painStatus.trim() !== 'なし' && painStatus.trim() !== '' && painStatus.trim() !== '--';

        const sleepAlert = (sleep || 0) <= 5;
        const fatigueRedAlert = (fatigue || 0) >= 5;
        const fatigueYellowAlert = (fatigue || 0) === 4;
        
        const alertStyleRed = 'color: #f87171; font-weight: bold;';
        const alertStyleYellow = 'color: #fbbf24; font-weight: bold;';
        
        let statusHtml = '';
        if (sleepAlert || fatigueRedAlert || hasPain) {
            // 赤アラート (高リスク)
            statusHtml = `<span class="status-badge status-danger"><i class="ph-fill ph-warning-circle"></i> アラート</span>`;
        } else if (fatigueYellowAlert) {
            // 黄色アラート (中リスク)
            statusHtml = `<span class="status-badge status-warning"><i class="ph-fill ph-warning"></i> 注意</span>`;
        } else {
            statusHtml = `<span class="status-badge status-good"><i class="ph-fill ph-check-circle"></i> 良好</span>`;
        }

        let painDisplay = painStatus;
        if (hasPain && details.painDesc) {
            painDisplay += `<br><small style="color:var(--text-muted);">${details.painDesc}</small>`;
        }

        const alertStyle = 'color: #f87171; font-weight: bold;';

        let pName = player.name || "不明";
        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=random&color=fff" style="width:32px; height:32px; border-radius:50%;">
                    <span style="font-weight: 500;">${pName}</span>
                </div>
            </td>
            <td style="${sleepAlert ? alertStyleRed : ''}">${(sleep || 0).toFixed(1)}h</td>
            <td style="${fatigueRedAlert ? alertStyleRed : fatigueYellowAlert ? alertStyleYellow : ''}">${(fatigue || 0).toFixed(1)}</td>
            <td style="max-width: 250px; white-space: normal; line-height: 1.4; ${hasPain ? alertStyleRed : ''}">${painDisplay}</td>
            <td>${statusHtml}</td>
        `;
        tbody.appendChild(tr);
    });

    if (targetPlayers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 24px;">この日付の回答データはありません</td></tr>';
    }
}

function getWeeklyPracticeTotal(player) {
    if (!player.detailsHistory || player.detailsHistory.length === 0 || !mockData.dates.length) return 0;
    
    const latestDateStr = mockData.dates[mockData.dates.length - 1];
    const latestDate = new Date(latestDateStr);
    
    // 直近の日曜日から土曜日、または月曜日から日曜日などの「週」を定義
    // ここでは最新の日付から遡って7日間、または同じ週（月〜日）の合計を計算します
    const day = latestDate.getDay();
    const diff = latestDate.getDate() - (day === 0 ? 6 : day - 1); // 月曜日を週の開始とする
    const monday = new Date(new Date(latestDateStr).setDate(diff));
    monday.setHours(0,0,0,0);
    
    let total = 0;
    player.dates.forEach((dStr, idx) => {
        const d = new Date(dStr);
        if (d >= monday) {
            const activity = player.detailsHistory[idx]?.activity || 0;
            total += activity;
        }
    });
    return total;
}

function updateDashboardForTeam() {
    document.getElementById('kpi-fatigue').textContent = mockData.team.avgFatigue.toFixed(1);
    document.getElementById('kpi-sleep').textContent = mockData.team.avgSleep.toFixed(1) + 'h';
    
    // チーム全体の週計平均
    let totalWeekly = 0;
    let count = 0;
    mockData.players.forEach(p => {
        totalWeekly += getWeeklyPracticeTotal(p);
        count++;
    });
    const avgWeekly = count > 0 ? totalWeekly / count : 0;

    document.getElementById('kpi-practice').textContent = avgWeekly.toFixed(1) + 'h';
    document.getElementById('kpi-practice-trend').innerHTML = '<span>チーム週計平均</span>';
    
    // Hide details panel for Team
    const detailsPanel = document.getElementById('condition-details-panel');
    if (detailsPanel) detailsPanel.style.display = 'none';

    document.getElementById('condition-chart-title-suffix').textContent = '- チーム平均';

    if (conditionChartInstance) {
        conditionChartInstance.data.labels = mockData.dates;
        conditionChartInstance.data.datasets[0].data = mockData.teamConditionTrend.fatigue;
        conditionChartInstance.data.datasets[1].data = mockData.teamConditionTrend.sleep;
        conditionChartInstance.update();
    }
}

function updateDashboardForPlayer(playerName) {
    const player = mockData.players.find(p => p.name === playerName);
    if (!player) return;

    document.getElementById('kpi-fatigue').textContent = player.currentFatigue.toFixed(1);
    document.getElementById('kpi-sleep').textContent = player.currentSleep.toFixed(1) + 'h';
    
    // 週間練習時間の表示
    const weeklyTotal = getWeeklyPracticeTotal(player);
    document.getElementById('kpi-practice').textContent = weeklyTotal.toFixed(1) + 'h';
    document.getElementById('kpi-practice-trend').innerHTML = '<span>今週の合計活動時間</span>';
    
    // Show and update condition details panel
    const detailsPanel = document.getElementById('condition-details-panel');
    if (detailsPanel) {
        detailsPanel.style.display = 'block';
        const d = player.currentDetails || {};
        document.getElementById('detail-fatigue').textContent = player.currentFatigue ? player.currentFatigue.toFixed(1) : '--';
        document.getElementById('detail-sleep').textContent = player.currentSleep ? player.currentSleep.toFixed(1) : '--';
        document.getElementById('detail-temp').textContent = d.temp ? d.temp.toFixed(1) : '--';
        document.getElementById('detail-hr').textContent = d.hr ? d.hr : '--';
        document.getElementById('detail-weight').textContent = d.weight ? d.weight.toFixed(1) : '--';
        document.getElementById('detail-bodyfat').textContent = d.bodyFat ? d.bodyFat.toFixed(1) : '--';
        document.getElementById('detail-sleep-quality').textContent = d.sleepQuality || '--';
        document.getElementById('detail-activity').textContent = d.activity ? d.activity.toFixed(1) : '--';
        document.getElementById('detail-pain-status').textContent = d.painStatus || '--';
        document.getElementById('detail-pain-desc').textContent = d.painDesc || '--';
    }

    document.getElementById('condition-chart-title-suffix').textContent = `- ${player.name}`;

    if (conditionChartInstance) {
        conditionChartInstance.data.labels = player.dates && player.dates.length > 0 ? player.dates : mockData.dates;
        conditionChartInstance.data.datasets[0].data = player.conditionTrend.fatigue;
        conditionChartInstance.data.datasets[1].data = player.conditionTrend.sleep;
        conditionChartInstance.update();
    }
}

function initSort() {
    const headers = document.querySelectorAll('.players-table th.sortable');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const col = header.dataset.sort;
            
            if (currentSort.col === col) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort.col = col;
                currentSort.asc = true;
            }

            headers.forEach(h => h.classList.remove('asc', 'desc'));
            header.classList.add(currentSort.asc ? 'asc' : 'desc');

            mockData.players.sort((a, b) => {
                let valA, valB;
                switch (col) {
                    case 'name': return currentSort.asc ? (a.name||'').localeCompare(b.name||'ja') : (b.name||'').localeCompare(a.name||'ja');
                    case 'fatigue': return currentSort.asc ? (a.currentFatigue||0) - (b.currentFatigue||0) : (b.currentFatigue||0) - (a.currentFatigue||0);
                    case 'sleep': return currentSort.asc ? (a.currentSleep||0) - (b.currentSleep||0) : (b.currentSleep||0) - (a.currentSleep||0);
                    case 'status':
                        const painA = ((a.currentDetails || {}).painStatus || "なし").trim();
                        const painB = ((b.currentDetails || {}).painStatus || "なし").trim();
                        const hasPainA = painA !== 'なし' && painA !== '' && painA !== '--';
                        const hasPainB = painB !== 'なし' && painB !== '' && painB !== '--';
                        const scoreA = (a.currentSleep <= 5 || a.currentFatigue >= 5 || hasPainA) ? 2 : (a.currentFatigue === 4 ? 1.5 : 1);
                        const scoreB = (b.currentSleep <= 5 || b.currentFatigue >= 5 || hasPainB) ? 2 : (b.currentFatigue === 4 ? 1.5 : 1);
                        return currentSort.asc ? scoreA - scoreB : scoreB - scoreA;
                    default: return 0;
                }
            });
            populatePlayersTable();
        });
    });
}

function initCharts() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";
    
    const ctxLine = document.getElementById('conditionLineChart').getContext('2d');
    const gradientFatigue = ctxLine.createLinearGradient(0, 0, 0, 400);
    gradientFatigue.addColorStop(0, 'rgba(236, 72, 153, 0.5)'); 
    gradientFatigue.addColorStop(1, 'rgba(236, 72, 153, 0.0)');
    const gradientSleep = ctxLine.createLinearGradient(0, 0, 0, 400);
    gradientSleep.addColorStop(0, 'rgba(59, 130, 246, 0.5)'); 
    gradientSleep.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    conditionChartInstance = new Chart(ctxLine, {
        type: 'line',
        data: {
            labels: mockData.dates,
            datasets: [
                { label: '疲労度 (1-5)', data: [], borderColor: '#ec4899', backgroundColor: gradientFatigue, borderWidth: 3, pointBackgroundColor: '#ec4899', pointBorderColor: '#fff', pointRadius: 4, fill: true, tension: 0.4, spanGaps: true, yAxisID: 'y' },
                { label: '睡眠時間 (h)', data: [], borderColor: '#3b82f6', backgroundColor: gradientSleep, borderWidth: 3, pointBackgroundColor: '#3b82f6', pointBorderColor: '#fff', pointRadius: 4, fill: true, tension: 0.4, spanGaps: true, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' }, tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)' } },
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false } },
                y: { type: 'linear', display: true, position: 'left', min: 1, max: 5, grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false } },
                y1: { type: 'linear', display: true, position: 'right', min: 4, max: 10, grid: { drawOnChartArea: false } }
            }
        }
    });

}
