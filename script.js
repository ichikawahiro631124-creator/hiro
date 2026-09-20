// LAN & ネットワーク機器シミュレータ (script.js)

document.addEventListener('DOMContentLoaded', () => {
  // DOM要素参照
  const topology = document.getElementById('topology');
  const svgLines = document.getElementById('network-lines');
  const packet = document.getElementById('packet');
  const packetSub = document.getElementById('packet-sub');

  const btnLanPing = document.getElementById('btn-lan-ping');
  const btnWanHttp = document.getElementById('btn-wan-http');
  const btnArp = document.getElementById('btn-arp');

  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');
  const speedRange = document.getElementById('speed-range');
  const speedLabel = document.getElementById('speed-label');

  const logContent = document.getElementById('log-content');
  const stepIndicator = document.getElementById('step-indicator');

  const hdrSip = document.getElementById('hdr-sip');
  const hdrDip = document.getElementById('hdr-dip');
  const hdrTtl = document.getElementById('hdr-ttl');
  const hdrSmac = document.getElementById('hdr-smac');
  const hdrDmac = document.getElementById('hdr-dmac');
  const l4Info = document.getElementById('l4-info');

  const tabMac = document.getElementById('tab-mac');
  const tabNat = document.getElementById('tab-nat');
  const tableMac = document.getElementById('mac-table');
  const tableNat = document.getElementById('nat-table');
  const macTableBody = document.getElementById('mac-table-body');
  const natTableBody = document.getElementById('nat-table-body');

  // ノード定義
  const nodes = {
    pca: document.getElementById('node-pca'),
    pcb: document.getElementById('node-pcb'),
    sw: document.getElementById('node-switch'),
    rt: document.getElementById('node-router'),
    srv: document.getElementById('node-server')
  };

  // 結線定義
  const connections = [
    { from: 'pca', to: 'sw', id: 'line-pca-sw' },
    { from: 'pcb', to: 'sw', id: 'line-pcb-sw' },
    { from: 'sw', to: 'rt', id: 'line-sw-rt' },
    { from: 'rt', to: 'srv', id: 'line-rt-srv' }
  ];

  // 内部状態
  let currentScenario = 'lan-ping';
  let isPlaying = false;
  let currentStep = 0;
  let timerId = null;
  let animSpeed = 1.0;

  // MACテーブル & NATテーブルの内部保持データ
  let macTableData = [];
  let natTableData = [];

  // トポロジーの配線を描画 (SVG)
  function drawWiring() {
    svgLines.innerHTML = '';
    const rectTop = topology.getBoundingClientRect();

    connections.forEach(conn => {
      const n1 = nodes[conn.from].getBoundingClientRect();
      const n2 = nodes[conn.to].getBoundingClientRect();

      const x1 = n1.left + n1.width / 2 - rectTop.left;
      const y1 = n1.top + n1.height / 2 - rectTop.top;
      const x2 = n2.left + n2.width / 2 - rectTop.left;
      const y2 = n2.top + n2.height / 2 - rectTop.top;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('id', conn.id);
      svgLines.appendChild(line);
    });
  }

  // ウィンドウリサイズ時に再描画
  window.addEventListener('resize', drawWiring);
  setTimeout(drawWiring, 100);

  // ノード位置の取得ヘルパー
  function getNodeCenter(nodeKey) {
    const rectTop = topology.getBoundingClientRect();
    const nodeRect = nodes[nodeKey].getBoundingClientRect();
    return {
      x: nodeRect.left + nodeRect.width / 2 - rectTop.left,
      y: nodeRect.top + nodeRect.height / 2 - rectTop.top
    };
  }

  // ハイライト制御
  function clearHighlights() {
    Object.values(nodes).forEach(n => {
      n.classList.remove('highlight', 'highlight-router');
    });
    document.querySelectorAll('.lines-svg line').forEach(l => l.classList.remove('active-wire'));
  }

  function highlightNode(nodeKey, isRouter = false) {
    if (nodes[nodeKey]) {
      nodes[nodeKey].classList.add(isRouter ? 'highlight-router' : 'highlight');
    }
  }

  function highlightLine(fromKey, toKey) {
    const conn = connections.find(c =>
      (c.from === fromKey && c.to === toKey) || (c.from === toKey && c.to === fromKey)
    );
    if (conn) {
      const line = document.getElementById(conn.id);
      if (line) line.classList.add('active-wire');
    }
  }

  // パケット移動アニメーション
  function movePacket(pElem, fromKey, toKey, duration, onComplete) {
    const start = getNodeCenter(fromKey);
    const end = getNodeCenter(toKey);

    pElem.style.display = 'flex';
    pElem.style.left = `${start.x}px`;
    pElem.style.top = `${start.y}px`;
    pElem.style.transition = `left ${duration}ms linear, top ${duration}ms linear`;

    // 次のフレームで移動開始
    requestAnimationFrame(() => {
      pElem.style.left = `${end.x}px`;
      pElem.style.top = `${end.y}px`;
    });

    setTimeout(() => {
      if (onComplete) onComplete();
    }, duration);
  }

  // シナリオ定義
  const scenarios = {
    'lan-ping': {
      name: '同一LAN内通信 (PC-A → PC-B)',
      steps: [
        {
          title: '送信元PC-Aでのカプセル化 (ARP解決済みと仮定)',
          text: 'PC-Aは宛先 192.168.1.20 が同一サブネット(同一LAN)にあることを確認し、ルータを通さずに直接PC-B宛てのEthernetフレームを生成してポート1へ送信します。',
          from: 'pca', to: 'sw',
          header: { sip: '192.168.1.10', dip: '192.168.1.20', ttl: '64', smac: 'AA:BB:CC:01:01', dmac: 'AA:BB:CC:01:02', l4: 'ICMP Echo Request' },
          action: () => {
            addMacEntry('Port 1', 'AA:BB:CC:01:01', '動的学習 (PC-A)');
          }
        },
        {
          title: 'L2スイッチでの受信とMACアドレステーブル学習・フォワーディング',
          text: 'L2スイッチはポート1に届いたフレームの【送信元MAC: AA:BB:CC:01:01】をMACテーブルに記録。宛先MAC (01:02) を参照し、ポート2のみへ転送します（無駄なフラッディングなし）。',
          from: 'sw', to: 'pcb',
          header: { sip: '192.168.1.10', dip: '192.168.1.20', ttl: '64', smac: 'AA:BB:CC:01:01', dmac: 'AA:BB:CC:01:02', l4: 'ICMP Echo Request' },
          action: () => {}
        },
        {
          title: '宛先PC-Bの受信とEcho Replyの返信',
          text: 'PC-Bが自身宛てのパケットを受信。ICMP Echo Reply（応答）を生成し、送信元を自分、宛先をPC-Aにしてスイッチ（ポート2）へ返送します。',
          from: 'pcb', to: 'sw',
          header: { sip: '192.168.1.20', dip: '192.168.1.10', ttl: '64', smac: 'AA:BB:CC:01:02', dmac: 'AA:BB:CC:01:01', l4: 'ICMP Echo Reply' },
          action: () => {
            addMacEntry('Port 2', 'AA:BB:CC:01:02', '動的学習 (PC-B)');
          }
        },
        {
          title: 'スイッチによるPC-Aへの正確な応答転送',
          text: 'スイッチはポート2から受信したPC-BのMACを学習し、宛先MAC (01:01) を確認してポート1へ転送します。PC-Aが応答を受け取りPingが成功します！',
          from: 'sw', to: 'pca',
          header: { sip: '192.168.1.20', dip: '192.168.1.10', ttl: '64', smac: 'AA:BB:CC:01:02', dmac: 'AA:BB:CC:01:01', l4: 'ICMP Echo Reply' },
          action: () => {}
        }
      ]
    },

    'wan-http': {
      name: 'WAN/インターネット通信 (PC-A → Webサーバ)',
      steps: [
        {
          title: 'デフォルトゲートウェイへのパケット送出',
          text: '宛先IP (203.0.113.80) はLAN外のため、PC-Aはデフォルトゲートウェイ(ルータ LAN側MAC: 01:GW)を宛先MACにして送信します。',
          from: 'pca', to: 'sw',
          header: { sip: '192.168.1.10', dip: '203.0.113.80', ttl: '64', smac: 'AA:BB:CC:01:01', dmac: 'AA:BB:CC:01:GW', l4: 'TCP SYN (Port: 80)' },
          action: () => {
            addMacEntry('Port 1', 'AA:BB:CC:01:01', '動的学習 (PC-A)');
          }
        },
        {
          title: 'L2スイッチがルータ向けポート3へ転送',
          text: 'スイッチは宛先MAC (01:GW) がルータ接続ポート（Port 3）にあることを認識し、ルータへ中継します。',
          from: 'sw', to: 'rt',
          header: { sip: '192.168.1.10', dip: '203.0.113.80', ttl: '64', smac: 'AA:BB:CC:01:01', dmac: 'AA:BB:CC:01:GW', l4: 'TCP SYN (Port: 80)' },
          action: () => {
            addMacEntry('Port 3', 'AA:BB:CC:01:GW', '静的/動的学習 (Router)');
          }
        },
        {
          title: 'ルータによるルーティング・TTL減少・NAPT(IPマスカレード)変換',
          text: 'ルータはパケットのTTLを64から63に減算。プライベートIP (192.168.1.10:50123) をWAN側グローバルIP (203.0.113.1:10050) に書き換えてNATテーブルに記録します。送信元MACもルータWANポートのものに変更します。',
          from: 'rt', to: 'srv',
          header: { sip: '203.0.113.1:10050', dip: '203.0.113.80:80', ttl: '63', smac: 'WAN-MAC-RT', dmac: 'FF:EE:DD:00:80', l4: 'TCP SYN (Port: 80)' },
          action: () => {
            addNatEntry('192.168.1.10:50123', '203.0.113.1:10050', '203.0.113.80:80');
          }
        },
        {
          title: 'Webサーバの受信とHTTP応答の返信',
          text: 'WebサーバはルータのグローバルIP宛てに応答 (SYN-ACK) を返します。Webサーバ側からは社内LANのプライベートIPは見えません。',
          from: 'srv', to: 'rt',
          header: { sip: '203.0.113.80:80', dip: '203.0.113.1:10050', ttl: '64', smac: 'FF:EE:DD:00:80', dmac: 'WAN-MAC-RT', l4: 'TCP SYN-ACK' },
          action: () => {}
        },
        {
          title: 'ルータの逆NAT変換とLAN内へのフォワーディング',
          text: 'ルータはNATテーブルを参照し、宛先ポート10050を内部PC-A (192.168.1.10:50123) に逆変換。TTLを63に減らし、宛先MACをPC-Aにしてスイッチへ送出します。',
          from: 'rt', to: 'sw',
          header: { sip: '203.0.113.80:80', dip: '192.168.1.10:50123', ttl: '63', smac: 'AA:BB:CC:01:GW', dmac: 'AA:BB:CC:01:01', l4: 'TCP SYN-ACK' },
          action: () => {}
        },
        {
          title: 'PC-AへのHTTPレスポンス到達',
          text: 'スイッチがMACアドレステーブルに基づきポート1へ転送。PC-Aが無事にWebサーバからのレスポンスを受信しました！',
          from: 'sw', to: 'pca',
          header: { sip: '203.0.113.80:80', dip: '192.168.1.10:50123', ttl: '63', smac: 'AA:BB:CC:01:GW', dmac: 'AA:BB:CC:01:01', l4: 'TCP SYN-ACK' },
          action: () => {}
        }
      ]
    },

    'arp': {
      name: 'ARP解決ブロードキャスト',
      steps: [
        {
          title: 'PC-AのARPリクエスト送信 (宛先MAC未解決)',
          text: 'PC-Aは 192.168.1.20 のMACアドレスが分からないため、宛先MACをブロードキャスト (FF:FF:FF:FF:FF:FF) にしたARP RequestをLAN全体へ送信します。',
          from: 'pca', to: 'sw',
          header: { sip: '192.168.1.10', dip: '192.168.1.20', ttl: '1', smac: 'AA:BB:CC:01:01', dmac: 'FF:FF:FF:FF:FF:FF', l4: 'ARP Who has 192.168.1.20?' },
          action: () => {
            addMacEntry('Port 1', 'AA:BB:CC:01:01', '動的学習 (PC-A)');
          }
        },
        {
          title: 'L2スイッチのフラッディング (全ポート転送)',
          text: '宛先がブロードキャストMACのため、スイッチは送信元以外の【すべてのポート】(PC-Bおよびルータ)へパケットをコピーしてフラッディング転送します。',
          from: 'sw', to: 'pcb',
          dualTo: 'rt', // ルータ側へも同時送信
          header: { sip: '192.168.1.10', dip: '192.168.1.20', ttl: '1', smac: 'AA:BB:CC:01:01', dmac: 'FF:FF:FF:FF:FF:FF', l4: 'ARP Flooding' },
          action: () => {}
        },
        {
          title: '各端末の判断とPC-BのユニキャストARP応答',
          text: 'ルータは自身宛てのIPではないためパケットを破棄。合致するPC-Bだけが「192.168.1.20は私(MAC: AA:BB:CC:01:02)です」とユニキャストで応答(ARP Reply)を返します。',
          from: 'pcb', to: 'sw',
          header: { sip: '192.168.1.20', dip: '192.168.1.10', ttl: '1', smac: 'AA:BB:CC:01:02', dmac: 'AA:BB:CC:01:01', l4: 'ARP Reply' },
          action: () => {
            addMacEntry('Port 2', 'AA:BB:CC:01:02', '動的学習 (PC-B)');
          }
        },
        {
          title: 'PC-AのARPキャッシュ更新',
          text: 'スイッチを通じてARP Replyを受け取ったPC-Aは、自身のARPキャッシュテーブルに「192.168.1.20 = AA:BB:CC:01:02」を記録。次回以降は直接ユニキャスト通信が可能になります。',
          from: 'sw', to: 'pca',
          header: { sip: '192.168.1.20', dip: '192.168.1.10', ttl: '1', smac: 'AA:BB:CC:01:02', dmac: 'AA:BB:CC:01:01', l4: 'ARP 解決完了' },
          action: () => {}
        }
      ]
    }
  };

  // テーブル更新関数
  function addMacEntry(port, mac, status) {
    if (!macTableData.some(e => e.port === port && e.mac === mac)) {
      macTableData.push({ port, mac, status });
      renderMacTable(true);
    }
  }

  function renderMacTable(highlightNew = false) {
    if (macTableData.length === 0) {
      macTableBody.innerHTML = '<tr><td colspan="3" class="empty-state">学習データなし (未通信)</td></tr>';
      return;
    }
    macTableBody.innerHTML = macTableData.map((e, idx) => `
      <tr class="${highlightNew && idx === macTableData.length - 1 ? 'new-row' : ''}">
        <td><strong>${e.port}</strong></td>
        <td>${e.mac}</td>
        <td><span style="color:#38bdf8;">${e.status}</span></td>
      </tr>
    `).join('');
  }

  function addNatEntry(internal, external, dest) {
    if (!natTableData.some(e => e.internal === internal)) {
      natTableData.push({ internal, external, dest });
      renderNatTable(true);
    }
  }

  function renderNatTable(highlightNew = false) {
    if (natTableData.length === 0) {
      natTableBody.innerHTML = '<tr><td colspan="3" class="empty-state">変換エントリなし</td></tr>';
      return;
    }
    natTableBody.innerHTML = natTableData.map((e, idx) => `
      <tr class="${highlightNew && idx === natTableData.length - 1 ? 'new-row' : ''}">
        <td>${e.internal}</td>
        <td style="color:#c084fc;">${e.external}</td>
        <td>${e.dest}</td>
      </tr>
    `).join('');
  }

  // ステップ実行ロジック
  function executeStep(stepIndex) {
    const scenario = scenarios[currentScenario];
    const steps = scenario.steps;

    if (stepIndex >= steps.length) {
      // 完了
      isPlaying = false;
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnStart.innerHTML = '<i class="fa-solid fa-rotate-right"></i> もう一度再生';
      appendLog('【完了】シミュレーションが完了しました。', 'success');
      return;
    }

    const step = steps[stepIndex];
    stepIndicator.textContent = `ステップ ${stepIndex + 1} / ${steps.length}`;

    // ログ追記
    appendLog(`<strong>[ステップ ${stepIndex + 1}] ${step.title}</strong><br>${step.text}`, 'active');

    // パケットヘッダ更新
    hdrSip.textContent = step.header.sip;
    hdrDip.textContent = step.header.dip;
    hdrTtl.textContent = step.header.ttl;
    hdrSmac.textContent = step.header.smac;
    hdrDmac.textContent = step.header.dmac;
    l4Info.textContent = step.header.l4;

    // ハイライト
    clearHighlights();
    highlightNode(step.from);
    highlightNode(step.to, step.to === 'rt');
    highlightLine(step.from, step.to);

    if (step.dualTo) {
      highlightNode(step.dualTo, step.dualTo === 'rt');
      highlightLine(step.from, step.dualTo);
    }

    // テーブルアクション実行
    step.action();

    // 移動アニメーション
    const stepDuration = 1800 / animSpeed;
    movePacket(packet, step.from, step.to, stepDuration, () => {
      packet.style.display = 'none';
      if (step.dualTo) packetSub.style.display = 'none';

      if (isPlaying) {
        currentStep++;
        timerId = setTimeout(() => executeStep(currentStep), 700 / animSpeed);
      }
    });

    if (step.dualTo) {
      movePacket(packetSub, step.from, step.dualTo, stepDuration);
    }
  }

  function appendLog(html, className = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.innerHTML = html;
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
  }

  // 再生制御
  function play() {
    isPlaying = true;
    btnStart.disabled = true;
    btnPause.disabled = false;
    executeStep(currentStep);
  }

  function pause() {
    isPlaying = false;
    clearTimeout(timerId);
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 再開';
  }

  function reset(keepTables = false) {
    isPlaying = false;
    clearTimeout(timerId);
    currentStep = 0;
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 再生';
    packet.style.display = 'none';
    packetSub.style.display = 'none';
    clearHighlights();
    stepIndicator.textContent = `ステップ 0 / ${scenarios[currentScenario].steps.length}`;

    logContent.innerHTML = '';
    appendLog(`<strong>${scenarios[currentScenario].name}</strong> を選択しました。「再生」を押してください。`, 'system');

    if (!keepTables) {
      macTableData = [];
      natTableData = [];
      renderMacTable();
      renderNatTable();
    }
  }

  // シナリオ切り替え
  function switchScenario(scKey, btnElement) {
    currentScenario = scKey;
    [btnLanPing, btnWanHttp, btnArp].forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');

    // WAN通信シナリオ時はNATテーブルタブをアクティブにするなどの親切設計
    if (scKey === 'wan-http') {
      tabNat.click();
    } else {
      tabMac.click();
    }

    reset();
  }

  // イベントリスナー
  btnLanPing.addEventListener('click', () => switchScenario('lan-ping', btnLanPing));
  btnWanHttp.addEventListener('click', () => switchScenario('wan-http', btnWanHttp));
  btnArp.addEventListener('click', () => switchScenario('arp', btnArp));

  btnStart.addEventListener('click', play);
  btnPause.addEventListener('click', pause);
  btnReset.addEventListener('click', () => reset(false));

  speedRange.addEventListener('input', (e) => {
    animSpeed = parseFloat(e.target.value);
    speedLabel.textContent = `${animSpeed.toFixed(2)}x`;
  });

  // タブ切り替え
  tabMac.addEventListener('click', () => {
    tabMac.classList.add('active');
    tabNat.classList.remove('active');
    tableMac.classList.add('active');
    tableNat.classList.remove('active');
  });

  tabNat.addEventListener('click', () => {
    tabNat.classList.add('active');
    tabMac.classList.remove('active');
    tableNat.classList.add('active');
    tableMac.classList.remove('active');
  });

  // 初期化
  reset();
  setTimeout(drawWiring, 200);
});
