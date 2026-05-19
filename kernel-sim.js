/* ══════════════════════════════════════════════════
   MINI OS KERNEL SIMULATOR — JAVASCRIPT
   kernel-sim.js
   ══════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════
//  PARTICLES BACKGROUND
// ══════════════════════════════════════════════════
const canvas = document.getElementById('particles-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function mkParticle() {
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 1.5 + 0.3,
    alpha: Math.random() * 0.5 + 0.1,
    color: Math.random() > 0.7 ? '#ff2952' : '#00d4ff'
  };
}
for (let i = 0; i < 120; i++) particles.push(mkParticle());

function drawParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw each particle
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.floor(p.alpha * 255).toString(16).padStart(2, '0');
    ctx.fill();
  });
  // Draw connection lines between nearby particles
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 100) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(0,212,255,${(1 - d / 100) * 0.08})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(drawParticles);
}
drawParticles();

// ══════════════════════════════════════════════════
//  BOOT SEQUENCE
// ══════════════════════════════════════════════════
const BOOT_MSGS = [
  '[ OK ] Loading kernel modules...',
  '[ OK ] Initializing memory subsystem...',
  '[ OK ] Mounting virtual file system...',
  '[ OK ] Starting process scheduler (RR/Priority)...',
  '[ OK ] Allocating memory segments...',
  '[ OK ] Loading I/O subsystem...',
  '[ OK ] Starting system logger...',
  '[ OK ] Waiting-state handler online...',
  '[ OK ] Kernel boot complete!',
  '// Launching GUI Shell...'
];
const bootLog = document.getElementById('boot-log');
let bootIdx = 0;

function bootTick() {
  if (bootIdx < BOOT_MSGS.length) {
    const l = document.createElement('div');
    l.className = 'boot-log-line';
    l.textContent = BOOT_MSGS[bootIdx++];
    bootLog.appendChild(l);
    setTimeout(bootTick, 200);
  } else {
    setTimeout(launchApp, 400);
  }
}
setTimeout(bootTick, 300);

function launchApp() {
  const bs = document.getElementById('boot-screen');
  gsap.to(bs, {
    opacity: 0, duration: 0.6, onComplete: () => {
      bs.style.display = 'none';
      const app = document.getElementById('app');
      app.style.display = 'flex';
      gsap.from(app, { opacity: 0, duration: 0.5 });
      initApp();
    }
  });
}

// ══════════════════════════════════════════════════
//  GLOBAL STATE
// ══════════════════════════════════════════════════
let pidCounter       = 1000;
let processes        = [];
let readyQueue       = [];
let waitingQueue     = [];
let schedulerInterval = null;
let timeQuantum      = 4;
let schedulerTime    = 0;
let cpuActive        = 0;
let cpuIdle          = 0;
let completedCount   = 0;
let ioEventCount     = 0;
let currentProc      = null;
let quantumLeft      = 0;
let schedulerAlgo    = 'rr';   // 'rr' | 'priority'
let memoryBlocks     = [];
const TOTAL_MEM      = 1024;
let files            = {};
let inodeCounter     = 1;
let logLines         = [];
let uptime           = 0;
let throughputCompleted = 0;
let simRunning       = false;

const COLORS = ['#00d4ff','#00ff88','#ffcc00','#bf5fff','#ff6633','#33ccff','#ff99aa','#00ccaa'];
const PROC_COLORS = {};

let cpuChartInst, memChartInst, fsChartInst;

// ══════════════════════════════════════════════════
//  INITIALISE APPLICATION
// ══════════════════════════════════════════════════
function initApp() {
  initCharts();
  initMemGrid();
  startClock();
  setInterval(updateSidebar, 1000);
  log('info', 'Kernel initialized. Scheduler: Round Robin | I/O Waiting State: ENABLED');
  log('success', 'All subsystems online. Ready.');
}

function initCharts() {
  // CPU history line chart
  const cpuCtx  = document.getElementById('cpu-chart').getContext('2d');
  const cpuData = Array(30).fill(0);
  cpuChartInst  = new Chart(cpuCtx, {
    type: 'line',
    data: { labels: cpuData.map((_,i)=>i), datasets: [{ data: cpuData, borderColor: '#00d4ff', borderWidth: 1.5, fill: true, backgroundColor: 'rgba(0,212,255,0.08)', tension: 0.4, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } } }
  });

  // Memory doughnut chart
  const memCtx = document.getElementById('mem-chart').getContext('2d');
  memChartInst = new Chart(memCtx, {
    type: 'doughnut',
    data: { labels: ['Used','Free'], datasets: [{ data: [0, 1024], backgroundColor: ['rgba(0,212,255,.7)','rgba(0,212,255,.08)'], borderColor: ['rgba(0,212,255,.3)','rgba(0,212,255,.05)'], borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, cutout: '75%' }
  });

  // File size bar chart
  const fsCtx = document.getElementById('fs-chart').getContext('2d');
  fsChartInst = new Chart(fsCtx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(0,212,255,.5)', borderColor: '#00d4ff', borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#2a4a5e', font: { size: 9 } }, grid: { color: 'rgba(0,212,255,.05)' } }, y: { ticks: { color: '#2a4a5e', font: { size: 9 } }, grid: { color: 'rgba(0,212,255,.05)' } } } }
  });
}

function initMemGrid() {
  const grid = document.getElementById('mem-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 80; i++) {
    const b = document.createElement('div');
    b.className = 'mem-block mem-free';
    b.id = 'mb-' + i;
    b.setAttribute('data-tip', `Block ${i}: Free`);
    grid.appendChild(b);
  }
}

// ══════════════════════════════════════════════════
//  CLOCK
// ══════════════════════════════════════════════════
function startClock() {
  setInterval(() => {
    const n = new Date();
    document.getElementById('clock').textContent =
      [n.getHours(), n.getMinutes(), n.getSeconds()]
        .map(v => String(v).padStart(2,'0')).join(':');
  }, 1000);
}

// ══════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════
function notify(msg, type = 'info') {
  const wrap  = document.getElementById('notif-wrap');
  const n     = document.createElement('div');
  n.className = `notif notif-${type}`;
  const icons = { info:'fa-circle-info', success:'fa-circle-check', error:'fa-circle-xmark', warn:'fa-triangle-exclamation' };
  n.innerHTML = `<i class="fa-solid ${icons[type]||'fa-circle-info'} notif-icon"></i><span>${msg}</span>`;
  wrap.appendChild(n);
  setTimeout(() => { n.style.animation = 'notifOut .3s ease forwards'; setTimeout(() => n.remove(), 300); }, 3000);
}

// ══════════════════════════════════════════════════
//  LOGGING
// ══════════════════════════════════════════════════
function ts() {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':')
    + '.' + String(n.getMilliseconds()).padStart(3,'0');
}

function log(type, msg) {
  const t = ts();
  logLines.push({ ts: t, type, msg });
  // Write to all log panels
  ['main-log','ov-log','queue-log','sched-log'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-time">[${t}]</span><span class="log-type-${type}">[${type.toUpperCase()}]</span><span class="log-msg">${msg}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  });
}

// Write to simulation log panel AND main log
function simLog(type, msg) {
  const t  = ts();
  const el = document.getElementById('sim-log');
  if (el) {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-time">[${t}]</span><span class="log-type-${type}">[${type.toUpperCase()}]</span><span class="log-msg">${msg}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  log(type, msg);
}

function clearLog() {
  logLines = [];
  document.getElementById('main-log').innerHTML = '';
  log('info', 'Log cleared.');
}

function exportLog() {
  const txt = logLines.map(l => `[${l.ts}] [${l.type.toUpperCase()}] ${l.msg}`).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/plain,' + encodeURIComponent(txt);
  a.download = 'kernel-log.txt';
  a.click();
}

// ══════════════════════════════════════════════════
//  VIEW SWITCHER
// ══════════════════════════════════════════════════
function switchView(name, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  el.classList.add('active');
}

// ══════════════════════════════════════════════════
//  MODULE 1 — PROCESS MANAGEMENT
// ══════════════════════════════════════════════════

/**
 * Create a new process and add it to the system.
 * Parameters can be passed directly (for demos / simulation flow)
 * or read from the form inputs.
 * @param {string} nameIn     - Process name prefix
 * @param {number} prioIn     - Priority (1=highest)
 * @param {number} burstIn    - Total CPU burst time in ms
 * @param {number} memIn      - Memory required in MB
 * @param {number} ioAt       - Burst tick at which I/O fires (0 = no I/O)
 */
function createProcess(nameIn, prioIn, burstIn, memIn, ioAt) {
  const name  = nameIn  || document.getElementById('proc-name').value  || 'process';
  const prio  = parseInt(prioIn  !== undefined ? prioIn  : document.getElementById('proc-prio').value)  || 5;
  const burst = parseInt(burstIn !== undefined ? burstIn : document.getElementById('proc-burst').value) || 10;
  const mem   = parseInt(memIn   !== undefined ? memIn   : document.getElementById('proc-mem').value)   || 64;
  const ioTick= parseInt(ioAt    !== undefined ? ioAt    : document.getElementById('proc-io').value)    || 0;

  const pid   = pidCounter++;
  const color = COLORS[pid % COLORS.length];
  PROC_COLORS[pid] = color;

  // Process Control Block (PCB)
  const proc = {
    pid, name: name + '_' + (pid % 100),
    priority: prio, burstTime: burst, remaining: burst,
    memRequired: mem, arrival: new Date().toLocaleTimeString(),
    state: 'new', color,
    ioAt: (ioTick > 0 && ioTick < burst) ? ioTick : 0,
    ioElapsed: 0,
    ioFile: null
  };

  processes.push(proc);
  renderProcessTable();
  allocateMemory(proc);       // Memory Manager: first-fit allocation

  // Transition NEW → READY after short delay
  setTimeout(() => {
    proc.state = 'ready';
    readyQueue.push(proc);
    renderProcessTable(); renderQueue();
    log('info', `PID ${pid} (${proc.name}) → READY | burst=${burst}ms | mem=${mem}MB | I/O@tick=${proc.ioAt || 'none'}`);
    updateOverview();
  }, 200);

  log('info', `Process created: PID=${pid} name=${proc.name} prio=${prio}`);
  notify(`PID ${pid} created`, 'success');
  updateBadge(); updateOverview();
  return proc;
}

const DEMO_NAMES = ['init','kthread','syslogd','httpd','mysqld','redis','nginx','bash','python','node','ffmpeg','compiler'];

function autoDemo() {
  const count = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const burst = 4 + Math.floor(Math.random() * 20);
      const ioAt  = Math.random() > 0.4 ? Math.ceil(burst * (0.3 + Math.random() * 0.4)) : 0;
      createProcess(
        DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)],
        Math.ceil(Math.random() * 8),
        burst,
        32 + Math.floor(Math.random() * 3) * 32,
        ioAt
      );
    }, i * 250);
  }
}

function clearTerminated() {
  processes = processes.filter(p => p.state !== 'terminated');
  renderProcessTable(); updateBadge(); updateOverview();
  log('info', 'Terminated processes cleared.');
}

function killProcess(pid) {
  const p = processes.find(p => p.pid === pid);
  if (!p) return;
  p.state = 'terminated';
  readyQueue   = readyQueue.filter(x => x.pid !== pid);
  waitingQueue = waitingQueue.filter(x => x.pid !== pid);
  freeMemory(pid);
  renderProcessTable(); renderQueue(); updateOverview();
  log('warn', `PID ${pid} (${p.name}) killed manually.`);
  notify(`PID ${pid} terminated`, 'error');
}

function renderProcessTable() {
  const tbody = document.getElementById('proc-tbody');
  tbody.innerHTML = '';
  processes.forEach(p => {
    const pc  = p.priority <= 3 ? 'prio-high' : p.priority <= 6 ? 'prio-med' : 'prio-low';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="color:${p.color}">${p.pid}</td>
      <td>${p.name}</td>
      <td class="${pc}">${p.priority}</td>
      <td>${p.arrival}</td>
      <td>${p.burstTime}ms</td>
      <td>${p.remaining}ms</td>
      <td>${p.memRequired}MB</td>
      <td>${p.ioAt || '—'}</td>
      <td><span class="state-badge state-${p.state}">${p.state.toUpperCase()}</span></td>
      <td>${p.state !== 'terminated'
        ? `<button class="btn btn-danger btn-sm" onclick="killProcess(${p.pid})"><i class="fa-solid fa-xmark"></i></button>`
        : '—'}</td>
    `;
    tbody.appendChild(row);
  });
  document.getElementById('ps-total').textContent   = processes.length;
  document.getElementById('ps-running').textContent = processes.filter(p => p.state === 'running').length;
  document.getElementById('ps-waiting').textContent = processes.filter(p => p.state === 'waiting').length;
  document.getElementById('ps-term').textContent    = processes.filter(p => p.state === 'terminated').length;
}

function updateBadge() {
  document.getElementById('badge-proc').textContent = processes.filter(p => p.state !== 'terminated').length;
}

// ══════════════════════════════════════════════════
//  MODULE 2 — READY QUEUE & WAITING QUEUE DISPLAY
// ══════════════════════════════════════════════════
function renderQueue() {
  // ── Ready Queue ──
  const rq = document.getElementById('queue-display');
  rq.innerHTML = '';
  if (readyQueue.length === 0) {
    rq.innerHTML = '<span class="text-dim">Queue is empty</span>';
  } else {
    readyQueue.forEach((p, i) => {
      if (i > 0) { const a = document.createElement('span'); a.className = 'queue-arrow'; a.textContent = '→'; rq.appendChild(a); }
      const card = document.createElement('div');
      card.className = 'queue-card';
      card.style.borderColor = p.color + '66';
      card.style.boxShadow   = `0 0 10px ${p.color}22`;
      card.innerHTML = `
        <div class="queue-card-pid" style="color:${p.color}">P${p.pid}</div>
        <div class="queue-card-name">${p.name}</div>
        <div class="queue-card-name">rem:${p.remaining}ms${schedulerAlgo === 'priority' ? ` p:${p.priority}` : ''}</div>
      `;
      rq.appendChild(card);
    });
  }
  document.getElementById('q-len').textContent = readyQueue.length;

  // ── Waiting Queue (I/O blocked) ──
  const wq = document.getElementById('waiting-display');
  wq.innerHTML = '';
  if (waitingQueue.length === 0) {
    wq.innerHTML = '<span class="text-dim">No blocked processes</span>';
  } else {
    waitingQueue.forEach(p => {
      const card = document.createElement('div');
      card.className = 'wait-card';
      card.innerHTML = `
        <div class="wait-card-pid">P${p.pid}</div>
        <div class="queue-card-name">${p.name}</div>
        <div class="queue-card-name" style="color:var(--neon-yellow)">I/O wait: ${p.ioWaitLeft || 0}ms</div>
      `;
      wq.appendChild(card);
    });
  }
  document.getElementById('wq-len').textContent = waitingQueue.length;

  // Show/hide waiting indicator in scheduler view
  const wi = document.getElementById('waiting-indicator');
  if (waitingQueue.length > 0) {
    wi.style.display = 'flex';
    document.getElementById('waiting-proc-names').textContent = waitingQueue.map(p => p.name).join(', ');
  } else {
    wi.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════
//  MODULE 3 — CPU SCHEDULER (Round Robin + Priority)
// ══════════════════════════════════════════════════

/** Toggle scheduling algorithm */
function setAlgo(algo) {
  schedulerAlgo = algo;
  document.getElementById('algo-rr').classList.toggle('selected', algo === 'rr');
  document.getElementById('algo-prio').classList.toggle('selected', algo === 'priority');
  document.getElementById('quantum-section').style.opacity = algo === 'rr' ? '1' : '.4';
  log('info', `Scheduler algorithm changed to: ${algo === 'rr' ? 'Round Robin' : 'Priority (Preemptive)'}`);
  notify(`Algorithm: ${algo === 'rr' ? 'Round Robin' : 'Priority'}`, 'info');
}

function changeQuantum(d) {
  timeQuantum = Math.max(1, Math.min(20, timeQuantum + d));
  document.getElementById('quantum-display').textContent = timeQuantum;
}

function startScheduler() {
  if (schedulerInterval) return;
  if (readyQueue.length === 0 && waitingQueue.length === 0) { notify('No processes!', 'error'); return; }
  log('info', `Scheduler started. Algo: ${schedulerAlgo === 'rr' ? 'Round Robin' : 'Priority'} | Quantum: ${timeQuantum}ms`);
  notify('Scheduler started', 'success');
  schedulerInterval = setInterval(schedTick, 500);
}

function stopScheduler() {
  clearInterval(schedulerInterval); schedulerInterval = null;
  document.getElementById('running-indicator').style.display = 'none';
  if (currentProc && currentProc.state === 'running') {
    currentProc.state = 'ready';
    readyQueue.unshift(currentProc);
    currentProc = null;
  }
  renderProcessTable(); renderQueue();
  log('warn', 'Scheduler stopped.');
}

function resetScheduler() {
  stopScheduler();
  processes.forEach(p => {
    if (p.state !== 'terminated') { p.remaining = p.burstTime; p.state = 'ready'; p.ioElapsed = 0; }
  });
  readyQueue   = processes.filter(p => p.state === 'ready');
  waitingQueue = [];
  cpuActive = 0; cpuIdle = 0; completedCount = 0; ioEventCount = 0;
  document.getElementById('gantt-bars').innerHTML  = '';
  document.getElementById('gantt-times').innerHTML = '';
  renderProcessTable(); renderQueue(); updateCPUStats();
  log('info', 'Scheduler reset.');
}

/**
 * One scheduler tick (called every 500ms).
 * Handles: I/O timer countdown, I/O trigger, RR/Priority dispatch, preemption.
 */
function schedTick() {
  schedulerTime++;

  // 1. Tick down I/O timers for waiting processes
  waitingQueue.forEach(p => {
    p.ioWaitLeft = (p.ioWaitLeft || 2) - 1;
    if (p.ioWaitLeft <= 0) {
      // I/O complete → back to ready queue
      p.state = 'ready';
      if (schedulerAlgo === 'priority') {
        readyQueue.push(p);
        readyQueue.sort((a, b) => a.priority - b.priority);
      } else {
        readyQueue.push(p);
      }
      log('success', `PID ${p.pid} (${p.name}) I/O COMPLETE → READY`);
      notify(`${p.name} I/O done → Ready`, 'success');
      addGanttBlock(p, 'wait_end');
    }
  });
  waitingQueue = waitingQueue.filter(p => p.state === 'waiting');

  // 2. Handle currently running process
  if (currentProc) {
    if (currentProc.remaining <= 0) {
      // Process finished
      currentProc.state = 'terminated'; completedCount++; throughputCompleted++;
      freeMemory(currentProc.pid);
      log('success', `PID ${currentProc.pid} (${currentProc.name}) TERMINATED`);
      notify(`${currentProc.name} complete`, 'success');
      currentProc = null;
    } else {
      // Check I/O trigger (Waiting State)
      currentProc.ioElapsed = (currentProc.ioElapsed || 0) + 1;
      if (currentProc.ioAt > 0 && currentProc.ioElapsed === currentProc.ioAt) {
        // Transition RUNNING → WAITING
        currentProc.state = 'waiting';
        currentProc.ioWaitLeft = 2;  // 2 ticks of I/O
        currentProc.ioAt = 0;        // fire only once

        // Simulate file write during I/O
        const fname = `proc_${currentProc.pid}_io.log`;
        if (!files[fname]) {
          const now = new Date().toLocaleTimeString();
          files[fname] = {
            content: `I/O write by PID ${currentProc.pid} at tick ${schedulerTime}`,
            size: 40, created: now, modified: now,
            inode: inodeCounter++, permissions: '-rw-r--r--',
            owner: currentProc.name
          };
          renderFileSystem();
        }
        waitingQueue.push(currentProc);
        ioEventCount++;
        log('warn', `PID ${currentProc.pid} (${currentProc.name}) → WAITING (I/O) | File: ${fname}`);
        notify(`${currentProc.name} → I/O Waiting`, 'warn');
        addGanttBlock(currentProc, 'io');
        currentProc = null;
      } else {
        // Normal execution tick
        currentProc.remaining--; quantumLeft--; cpuActive++;

        // Round Robin preemption
        if (schedulerAlgo === 'rr' && quantumLeft <= 0 && currentProc && currentProc.remaining > 0) {
          currentProc.state = 'ready';
          log('warn', `PID ${currentProc.pid} preempted (RR). Remaining: ${currentProc.remaining}ms`);
          readyQueue.push(currentProc);
          currentProc = null;
        }
        // Priority preemption: yield if higher-priority process arrived
        else if (schedulerAlgo === 'priority' && currentProc && readyQueue.length > 0) {
          const highest = readyQueue.reduce((a, b) => a.priority < b.priority ? a : b);
          if (highest.priority < currentProc.priority) {
            currentProc.state = 'ready';
            log('warn', `PID ${currentProc.pid} preempted by higher-prio PID ${highest.pid}`);
            readyQueue.push(currentProc);
            readyQueue.sort((a, b) => a.priority - b.priority);
            currentProc = null;
          }
        }
      }
    }
  }

  // 3. Dispatch next process if CPU is free
  if (!currentProc && readyQueue.length > 0) {
    if (schedulerAlgo === 'priority') readyQueue.sort((a, b) => a.priority - b.priority);
    currentProc = readyQueue.shift();
    currentProc.state = 'running'; currentProc.ioElapsed = 0;
    quantumLeft = timeQuantum;
    log('info', `PID ${currentProc.pid} (${currentProc.name}) → RUNNING | algo=${schedulerAlgo} prio=${currentProc.priority}`);
    addGanttBlock(currentProc, 'run');
    document.getElementById('running-indicator').style.display = 'flex';
    document.getElementById('running-proc-name').textContent = `${currentProc.name} (PID ${currentProc.pid})`;
  } else if (!currentProc) {
    // CPU idle
    cpuIdle++;
    document.getElementById('running-indicator').style.display = 'none';
    if (waitingQueue.length === 0) {
      // All work done
      stopScheduler();
      log('success', 'All processes completed. Scheduler idle.');
      notify('All processes completed!', 'success');
      return;
    }
    addGanttBlock(null, 'idle');
  }

  renderProcessTable(); renderQueue(); updateCPUStats(); updateOverview();
  document.getElementById('sched-active').textContent = cpuActive;
  document.getElementById('sched-idle').textContent   = cpuIdle;
  document.getElementById('sched-done').textContent   = completedCount;
  document.getElementById('sched-io').textContent     = ioEventCount;
}

function updateCPUStats() {
  const total = cpuActive + cpuIdle || 1;
  const util  = Math.round(cpuActive / total * 100);
  const offset = 339 - (339 * util / 100);

  ['cpu-ring-fill','cpu-ring-fill2'].forEach(id => {
    const e = document.getElementById(id); if (e) e.style.strokeDashoffset = offset;
  });
  ['cpu-ring-val','cpu-ring-val2'].forEach(id => {
    const e = document.getElementById(id); if (e) e.textContent = util + '%';
  });
  document.getElementById('topnav-cpu').style.width      = util + '%';
  document.getElementById('topnav-cpu-val').textContent  = util + '%';

  if (cpuChartInst) {
    cpuChartInst.data.datasets[0].data.push(util);
    cpuChartInst.data.datasets[0].data.shift();
    cpuChartInst.update('none');
  }
  const el = document.getElementById('ov-cpu');
  if (el) el.innerHTML = util + '<span style="font-size:.8rem">%</span>';
}

/** Append one block to the Gantt chart */
function addGanttBlock(proc, type) {
  const bars  = document.getElementById('gantt-bars');
  const times = document.getElementById('gantt-times');
  const block = document.createElement('div');
  block.className = 'gantt-block';

  if (type === 'idle') {
    block.classList.add('gantt-block-idle'); block.textContent = 'IDLE';
  } else if (type === 'io') {
    block.classList.add('gantt-block-wait'); block.textContent = 'I/O';
  } else if (type === 'wait_end') {
    block.classList.add('gantt-block-wait'); block.textContent = '←IO';
  } else {
    block.style.background  = proc.color + '33';
    block.style.borderColor = proc.color + '88';
    block.style.color       = proc.color;
    block.textContent       = 'P' + (proc.pid % 100);
  }
  block.title = proc ? `${proc.name} (PID ${proc.pid})` : 'Idle';
  bars.appendChild(block);

  const tl = document.createElement('div');
  tl.className  = 'gantt-time';
  tl.textContent = schedulerTime;
  times.appendChild(tl);
  bars.scrollLeft = bars.scrollWidth;
}

// ══════════════════════════════════════════════════
//  MODULE 4 — MEMORY MANAGEMENT (First Fit)
// ══════════════════════════════════════════════════

/**
 * Allocate memory for a process using First Fit strategy.
 * The 1024 MB address space is split into 80 equal blocks.
 */
function allocateMemory(proc) {
  const blockSize = TOTAL_MEM / 80;
  const needed    = Math.ceil(proc.memRequired / blockSize);
  let start = -1, count = 0;

  for (let i = 0; i < 80; i++) {
    const occupied = memoryBlocks.some(b => i >= b.startIdx && i < b.startIdx + b.blocks);
    if (!occupied) {
      if (start === -1) start = i;
      count++;
      if (count >= needed) break;
    } else { start = -1; count = 0; }
  }

  if (count < needed || start === -1) {
    log('error', `Memory FAILED for PID ${proc.pid} — not enough contiguous space.`);
    notify(`Memory full! PID ${proc.pid}`, 'error');
    return false;
  }

  memoryBlocks.push({ pid: proc.pid, name: proc.name, startIdx: start, blocks: needed, size: proc.memRequired });
  updateMemVisual();
  log('info', `Memory allocated: PID ${proc.pid} → blocks ${start}-${start + needed - 1} (${proc.memRequired} MB)`);
  return true;
}

function freeMemory(pid) {
  const before = memoryBlocks.length;
  memoryBlocks = memoryBlocks.filter(b => b.pid !== pid);
  if (memoryBlocks.length < before) { updateMemVisual(); log('info', `Memory freed: PID ${pid}`); }
}

function updateMemVisual() {
  const blockSize = TOTAL_MEM / 80;

  // Reset all blocks to free
  for (let i = 0; i < 80; i++) {
    const el = document.getElementById('mb-' + i);
    if (!el) continue;
    el.className = 'mem-block mem-free';
    el.style.background = el.style.borderColor = '';
    el.setAttribute('data-tip', `Block ${i}: Free`);
  }

  // Colour allocated blocks
  memoryBlocks.forEach(b => {
    const color = (processes.find(p => p.pid === b.pid) || { color: '#00ff88' }).color;
    for (let i = b.startIdx; i < b.startIdx + b.blocks; i++) {
      const el = document.getElementById('mb-' + i);
      if (!el) continue;
      el.className = 'mem-block mem-used';
      el.style.background  = color + '44';
      el.style.borderColor = color + '88';
      el.setAttribute('data-tip', `Block ${i}: PID ${b.pid} (${b.name})`);
    }
  });

  const usedMem = memoryBlocks.reduce((a, b) => a + b.size, 0);
  const freeMem = TOTAL_MEM - usedMem;
  const frag    = memoryBlocks.length > 1 ? Math.round((memoryBlocks.length - 1) * 5) : 0;

  document.getElementById('mem-used-val').innerHTML = usedMem + '<span style="font-size:.7rem">MB</span>';
  document.getElementById('mem-free-val').innerHTML = freeMem + '<span style="font-size:.7rem">MB</span>';
  document.getElementById('mem-frag-val').innerHTML = frag    + '<span style="font-size:.7rem">%</span>';
  document.getElementById('mem-bar').style.width    = (usedMem / TOTAL_MEM * 100) + '%';
  document.getElementById('topnav-mem').textContent = Math.round(usedMem / TOTAL_MEM * 100) + '%';

  // Allocation table
  const tbody = document.getElementById('mem-table');
  tbody.innerHTML = '';
  memoryBlocks.forEach((b, i) => {
    const color = (processes.find(p => p.pid === b.pid) || { color: '#00ff88' }).color;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>SEG-${String(i).padStart(2,'0')}</td>
      <td style="color:${color}">${b.name} (${b.pid})</td>
      <td>${Math.floor(b.startIdx * TOTAL_MEM / 80)} MB</td>
      <td>${Math.floor((b.startIdx + b.blocks) * TOTAL_MEM / 80)} MB</td>
      <td>${b.size} MB</td>
      <td><span class="state-badge state-running">ALLOCATED</span></td>
    `;
    tbody.appendChild(tr);
  });
  if (memoryBlocks.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="text-align:center;color:var(--text-dim);padding:20px;">No memory allocated</td>';
    tbody.appendChild(tr);
  }

  if (memChartInst) { memChartInst.data.datasets[0].data = [usedMem, freeMem]; memChartInst.update('none'); }
  document.getElementById('sb-mem').textContent = freeMem;
  if (document.getElementById('ov-mem'))  document.getElementById('ov-mem').innerHTML = usedMem + '<span style="font-size:.8rem">MB</span>';
  if (document.getElementById('ov-mem2')) document.getElementById('ov-mem2').textContent = usedMem + ' MB';
  if (document.getElementById('ov-free')) document.getElementById('ov-free').textContent = freeMem + ' MB';
  if (document.getElementById('ov-frag')) document.getElementById('ov-frag').textContent = frag + '%';
}

// ══════════════════════════════════════════════════
//  MODULE 5 — FILE SYSTEM
// ══════════════════════════════════════════════════
function fsCreate() {
  const name    = document.getElementById('fs-name').value.trim();
  const content = document.getElementById('fs-content').value;
  if (!name) { notify('Enter a file name!', 'error'); return; }
  if (files[name]) { notify('File already exists!', 'error'); return; }

  const now = new Date().toLocaleTimeString();
  files[name] = { content, size: new TextEncoder().encode(content).length, created: now, modified: now, inode: inodeCounter++, permissions: '-rw-r--r--' };
  renderFileSystem();
  log('success', `File created: /root/${name} (${files[name].size} bytes)`);
  notify(`Created ${name}`, 'success');
}

function fsWrite() {
  const name    = document.getElementById('fs-name').value.trim();
  const content = document.getElementById('fs-content').value;
  if (!name) { notify('Enter a file name!', 'error'); return; }
  if (!files[name]) { notify('File not found!', 'error'); return; }

  files[name].content  = content;
  files[name].size     = new TextEncoder().encode(content).length;
  files[name].modified = new Date().toLocaleTimeString();
  renderFileSystem();
  log('info', `File written: /root/${name} (${files[name].size} bytes)`);
  notify(`Written to ${name}`, 'success');
}

function fsRead() {
  const name = document.getElementById('fs-name').value.trim();
  if (!name) { notify('Enter a file name!', 'error'); return; }
  if (!files[name]) { notify('File not found!', 'error'); return; }
  document.getElementById('fs-read-result').textContent = files[name].content || '(empty)';
  log('info', `File read: /root/${name} | inode:${files[name].inode} | ${files[name].size} bytes`);
}

function fsDelete(name) {
  if (!files[name]) return;
  delete files[name];
  renderFileSystem();
  log('warn', `File deleted: /root/${name}`);
  notify(`Deleted ${name}`, 'error');
}

function renderFileSystem() {
  const list   = document.getElementById('file-list');
  const inodes = document.getElementById('inode-tbody');
  const names  = Object.keys(files);

  if (names.length === 0) {
    list.innerHTML   = '<span class="text-dim">No files yet.</span>';
    inodes.innerHTML = '';
    ['fs-total-files','sb-files','ov-files'].forEach(id => document.getElementById(id) && (document.getElementById(id).textContent = 0));
    if (fsChartInst) { fsChartInst.data.labels = []; fsChartInst.data.datasets[0].data = []; fsChartInst.update('none'); }
    updateFsStorage(); return;
  }

  list.innerHTML = ''; inodes.innerHTML = '';
  const iconMap  = { txt:'fa-file-lines', js:'fa-file-code', py:'fa-file-code', json:'fa-file-code', html:'fa-file-code', log:'fa-file-alt', csv:'fa-file-csv' };

  names.forEach(name => {
    const f   = files[name];
    const ext = name.includes('.') ? name.split('.').pop() : '';
    const icon = iconMap[ext] || 'fa-file';

    // Directory entry
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <i class="fa-solid ${icon} file-icon"></i>
      <span class="file-name">/root/${name}</span>
      <span class="file-size">${formatBytes(f.size)}</span>
      <span class="file-date">${f.modified}</span>
      <div class="file-actions">
        <button class="btn btn-sm btn-primary" onclick="viewFile('${name}')"><i class="fa-solid fa-eye"></i></button>
        <button class="btn btn-sm btn-danger"  onclick="fsDelete('${name}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    list.appendChild(item);

    // Inode table entry
    const blocks = Math.ceil(f.size / 512) || 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.inode}</td><td>${name}</td><td>${formatBytes(f.size)}</td><td>${f.permissions}</td><td>${f.created}</td><td>${f.modified}</td><td>${blocks}</td>`;
    inodes.appendChild(tr);
  });

  ['fs-total-files','sb-files','ov-files'].forEach(id => document.getElementById(id) && (document.getElementById(id).textContent = names.length));

  if (fsChartInst) {
    fsChartInst.data.labels = names.map(n => n.length > 8 ? n.slice(0,8)+'…' : n);
    fsChartInst.data.datasets[0].data = names.map(n => files[n].size);
    fsChartInst.update('none');
  }
  updateFsStorage();
}

function updateFsStorage() {
  const total = Object.values(files).reduce((a,f) => a + f.size, 0);
  const pct   = Math.min(100, total / (1024 * 1024) * 100);
  const bar   = document.getElementById('fs-storage-bar');
  const used  = document.getElementById('fs-used-bytes');
  if (bar)  bar.style.width = pct + '%';
  if (used) used.textContent = formatBytes(total);
}

function viewFile(name) {
  const f = files[name]; if (!f) return;
  document.getElementById('modal-filename').textContent = `/root/${name}  [${formatBytes(f.size)}]  inode:${f.inode}`;
  document.getElementById('modal-content').textContent  = f.content || '(empty)';
  document.getElementById('file-modal').classList.add('show');
  log('info', `Viewed file: /root/${name}`);
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

// ══════════════════════════════════════════════════
//  OVERVIEW & SIDEBAR
// ══════════════════════════════════════════════════
function updateOverview() {
  document.getElementById('ov-procs').textContent   = processes.length;
  document.getElementById('ov-waiting').textContent = processes.filter(p => p.state === 'waiting').length;
  document.getElementById('sb-proc').textContent    = processes.filter(p => p.state !== 'terminated').length;
  document.getElementById('sb-waiting').textContent = waitingQueue.length;
  document.getElementById('badge-proc').textContent = processes.filter(p => p.state !== 'terminated').length;
}

function updateSidebar() {
  uptime++;
  const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = uptime % 60;
  document.getElementById('sb-uptime').textContent =
    h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : s + 's';
}

// ══════════════════════════════════════════════════
//  5-STEP SIMULATION FLOW (Lab Manual §5)
// ══════════════════════════════════════════════════
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function simStepActivate(n) {
  document.getElementById('sim-step-' + n).classList.add('active');
  const icon = document.getElementById('sim-icon-' + n);
  icon.className = 'fa-solid fa-spinner fa-spin'; icon.style.color = 'var(--neon-blue)';
}

function simStepDone(n, badgeText, rgb) {
  const el   = document.getElementById('sim-step-' + n);
  el.classList.remove('active'); el.classList.add('done');
  const icon = document.getElementById('sim-icon-' + n);
  icon.className = 'fa-solid fa-circle-check'; icon.style.color = 'var(--neon-green)';
  const badge = document.getElementById('sim-badge-' + n);
  badge.style.display  = 'inline-block';
  badge.textContent    = badgeText;
  badge.style.background = `rgba(${rgb || '0,255,136'},.15)`;
  badge.style.color      = `rgb(${rgb || '0,255,136'})`;
  badge.style.border     = `1px solid rgba(${rgb || '0,255,136'},.3)`;
}

function simReset(n) {
  const el   = document.getElementById('sim-step-' + n);
  el.classList.remove('active','done');
  const icon = document.getElementById('sim-icon-' + n);
  icon.className = 'fa-solid fa-circle-notch'; icon.style.color = 'var(--text-dim)';
  document.getElementById('sim-badge-' + n).style.display = 'none';
}

function resetSimulation() {
  for (let i = 1; i <= 5; i++) simReset(i);
  document.getElementById('sim-log').innerHTML = '';
  simRunning = false;
}

async function runSimulationFlow() {
  if (simRunning) { notify('Simulation already running!', 'warn'); return; }
  simRunning = true; resetSimulation();

  // ─── STEP 1: Process Creation ───────────────────
  simStepActivate(1);
  simLog('info', '[STEP 1] Process Manager: Creating process sim_proc...');
  await delay(600);
  const simProc = createProcess('sim_proc', 3, 14, 96, 5); // I/O fires at burst tick 5
  await delay(600);
  simLog('success', `[STEP 1] PCB created: PID=${simProc.pid} | Memory Manager: Allocating 96 MB...`);
  await delay(500);
  simLog('success', `[STEP 1] Memory allocated. PID ${simProc.pid} → enqueued in Ready Queue.`);
  simStepDone(1, `PID ${simProc.pid} created & queued`);

  await delay(800);

  // ─── STEP 2: Scheduler Dispatch ─────────────────
  simStepActivate(2);
  simLog('info', `[STEP 2] Scheduler: Dequeuing PID ${simProc.pid} from Ready Queue...`);
  await delay(600);
  readyQueue = readyQueue.filter(p => p.pid !== simProc.pid);
  simProc.state = 'running'; simProc.ioElapsed = 0;
  currentProc = simProc; quantumLeft = timeQuantum;
  renderProcessTable(); renderQueue();
  document.getElementById('running-indicator').style.display = 'flex';
  document.getElementById('running-proc-name').textContent   = `${simProc.name} (PID ${simProc.pid})`;
  addGanttBlock(simProc, 'run');
  updateOverview();
  simLog('success', `[STEP 2] PID ${simProc.pid} → RUNNING. Execution timer started.`);
  simStepDone(2, `PID ${simProc.pid} dispatched`);

  await delay(1000);

  // ─── STEP 3: I/O → WAITING ──────────────────────
  simStepActivate(3);
  simLog('warn', `[STEP 3] PID ${simProc.pid} issues file write I/O syscall...`);
  await delay(700);

  simProc.state = 'waiting'; simProc.ioWaitLeft = 3;
  const ioFile  = `sim_${simProc.pid}_data.log`;
  const now     = new Date().toLocaleTimeString();
  files[ioFile] = {
    content: `Kernel I/O write from PID ${simProc.pid}\nData: ${JSON.stringify({ pid: simProc.pid, time: now, op: 'write' })}`,
    size: 80, created: now, modified: now,
    inode: inodeCounter++, permissions: '-rw-r--r--', owner: simProc.name
  };
  renderFileSystem();
  waitingQueue.push(simProc); ioEventCount++;
  currentProc = null;
  document.getElementById('running-indicator').style.display = 'none';
  addGanttBlock(simProc, 'io');
  renderProcessTable(); renderQueue(); updateOverview();

  simLog('success', `[STEP 3] File System: inode ${files[ioFile].inode} allocated for /root/${ioFile}`);
  await delay(600);
  simLog('warn', `[STEP 3] PID ${simProc.pid} → WAITING. I/O timer: 3 ticks...`);
  await delay(800);

  // I/O complete
  simProc.state = 'ready'; simProc.ioWaitLeft = 0; simProc.ioAt = 0;
  waitingQueue  = waitingQueue.filter(p => p.pid !== simProc.pid);
  readyQueue.push(simProc);
  renderProcessTable(); renderQueue(); updateOverview();
  simLog('success', `[STEP 3] I/O COMPLETE. PID ${simProc.pid} → READY.`);
  simStepDone(3, `I/O done → /root/${ioFile}`, '255,204,0');

  await delay(800);

  // ─── STEP 4: Termination ────────────────────────
  simStepActivate(4);
  simLog('info', `[STEP 4] Scheduler: Dispatching PID ${simProc.pid} for final burst...`);
  await delay(600);

  simProc.state = 'running'; simProc.remaining = 0;
  readyQueue    = readyQueue.filter(p => p.pid !== simProc.pid);
  renderProcessTable(); renderQueue(); addGanttBlock(simProc, 'run');
  await delay(600);

  simProc.state = 'terminated'; completedCount++;
  freeMemory(simProc.pid); currentProc = null;
  document.getElementById('running-indicator').style.display = 'none';
  renderProcessTable(); renderQueue(); updateCPUStats(); updateOverview();
  simLog('success', `[STEP 4] PID ${simProc.pid} TERMINATED. Memory Manager: 96 MB freed.`);
  simStepDone(4, `PID ${simProc.pid} terminated`, '255,41,82');

  await delay(800);

  // ─── STEP 5: File Read ──────────────────────────
  simStepActivate(5);
  simLog('info', `[STEP 5] File read request: /root/${ioFile}`);
  await delay(600);
  const f = files[ioFile];
  simLog('success', `[STEP 5] inode ${f.inode} accessed. Data blocks read. Content returned.`);
  await delay(400);
  simLog('success', `[STEP 5] Content preview: "${f.content.slice(0,60)}..."`);
  simStepDone(5, `/root/${ioFile} read`);

  await delay(400);
  simLog('success', '[COMPLETE] All 5 simulation steps executed. Inter-subsystem interaction demonstrated.');
  notify('Simulation complete!', 'success');
  simRunning = false;
}

// ══════════════════════════════════════════════════
//  MODAL — CLOSE ON OVERLAY CLICK
// ══════════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
});