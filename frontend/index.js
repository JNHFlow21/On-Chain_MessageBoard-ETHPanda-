// Minimal frontend for MessageBoard
// Switched to Ethers v5 for better MetaMask interop

const state = {
  provider: null, // ethers.providers.Web3Provider
  signer: null,   // ethers.Signer
  account: null,
  contract: null,
  contractAddress: "",
  abi: [
    // Read
    { "type": "function", "name": "total", "inputs": [], "outputs": [{"type":"uint256"}], "stateMutability": "view" },
    { "type": "function", "name": "postFee", "inputs": [], "outputs": [{"type":"uint256"}], "stateMutability": "view" },
    { "type": "function", "name": "rateLimitSeconds", "inputs": [], "outputs": [{"type":"uint64"}], "stateMutability": "view" },
    { "type": "function", "name": "maxContentLengthBytes", "inputs": [], "outputs": [{"type":"uint256"}], "stateMutability": "view" },
    { "type": "function", "name": "getLatest", "inputs": [{"type":"uint256","name":"count"}], "outputs": [{"type":"tuple[]","components":[
      {"name":"id","type":"uint256"},
      {"name":"author","type":"address"},
      {"name":"content","type":"string"},
      {"name":"createdAt","type":"uint64"},
      {"name":"editedAt","type":"uint64"},
      {"name":"isDeleted","type":"bool"},
      {"name":"parentId","type":"uint256"}
    ]}], "stateMutability": "view" },
    { "type": "function", "name": "getRange", "inputs": [
      {"type":"uint256","name":"start"},
      {"type":"uint256","name":"count"}
    ], "outputs": [{"type":"tuple[]","components":[
      {"name":"id","type":"uint256"},
      {"name":"author","type":"address"},
      {"name":"content","type":"string"},
      {"name":"createdAt","type":"uint64"},
      {"name":"editedAt","type":"uint64"},
      {"name":"isDeleted","type":"bool"},
      {"name":"parentId","type":"uint256"}
    ]}], "stateMutability": "view" },
    // Write
    { "type": "function", "name": "post", "inputs": [{"type":"string","name":"content"},{"type":"uint256","name":"parentId"}], "outputs": [{"type":"uint256"}], "stateMutability": "payable" },
    { "type": "function", "name": "edit", "inputs": [{"type":"uint256","name":"id"},{"type":"string","name":"newContent"}], "outputs": [], "stateMutability": "nonpayable" },
    { "type": "function", "name": "softDelete", "inputs": [{"type":"uint256","name":"id"}], "outputs": [], "stateMutability": "nonpayable" },
  ],
  page: { start: 0, step: 10, finished: false },
  lastTotal: ethers.BigNumber.from(0),
  pollTimer: null,
  connecting: false,
};

const $ = (id) => document.getElementById(id);
const fmtAddr = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : "";
const setStatus = (t) => ($("statusBox").textContent = t);
function updateUiConnected(connected) {
  const btn = document.getElementById('connectBtn');
  if (btn) btn.textContent = connected ? '已连接' : '连接钱包';
}
function updateConnectBtnDisabled(disabled) {
  const btn = document.getElementById('connectBtn');
  if (btn) btn.disabled = !!disabled;
}

function getInjectedEthereum() {
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    return mm || eth.providers[0];
  }
  return eth;
}

async function ensureProvider() {
  const injected = getInjectedEthereum();
  if (!injected) throw new Error("未检测到钱包注入。请检查 MetaMask 是否已对本网站启用访问权限。");
  if (!state.provider) state.provider = new ethers.providers.Web3Provider(injected, 'any');
  return state.provider;
}

async function connectWallet() {
  if (!getInjectedEthereum()) {
    alert('未检测到钱包注入。请在浏览器扩展管理中将 MetaMask 的“站点访问”设置为“在所有网站”，或点击右上角扩展图标为本页面开启访问。');
    return;
  }
  if (state.connecting) return;
  state.connecting = true; updateConnectBtnDisabled(true); setStatus('正在请求钱包授权...');
  const tipTimer = setTimeout(() => {
    if (state.connecting) setStatus('如果未弹出 MetaMask，请点击浏览器右上角扩展图标，允许本网站访问钱包');
  }, 8000);
  try {
    const injected = getInjectedEthereum();
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    await ensureProvider();
    if (!accounts || accounts.length === 0) throw new Error('未授权账户');
    state.account = ethers.utils.getAddress(accounts[0]);
    state.signer = state.provider.getSigner();
    setStatus(`已连接：${fmtAddr(state.account)}`);
    updateUiConnected(true);
    bindEthereumEvents();
  } catch (e) {
    console.error(e);
    setStatus(parseEthersError(e));
  }
  clearTimeout(tipTimer);
  state.connecting = false; updateConnectBtnDisabled(false);
}

async function restoreConnectionIfAny() {
  if (!getInjectedEthereum()) return;
  await ensureProvider();
  try {
    const injected = getInjectedEthereum();
    const accounts = await injected.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      state.account = ethers.utils.getAddress(accounts[0]);
      state.signer = state.provider.getSigner();
      setStatus(`已连接：${fmtAddr(state.account)}`);
      updateUiConnected(true);
      bindEthereumEvents();
    }
  } catch {}
}

function bindEthereumEvents() {
  const injected = getInjectedEthereum();
  if (!injected || bindEthereumEvents._bound) return;
  injected.on?.('accountsChanged', async (accounts) => {
    if (!accounts || accounts.length === 0) {
      state.account = null; state.signer = null;
      setStatus('钱包未连接');
      updateUiConnected(false);
      return;
    }
    state.account = ethers.utils.getAddress(accounts[0]);
    state.signer = state.provider.getSigner();
    setStatus(`已连接：${fmtAddr(state.account)}`);
    updateUiConnected(true);
    refreshFromStart();
  });
  injected.on?.('chainChanged', () => {
    // 切换网络后刷新读取
    refreshFromStart();
  });
  bindEthereumEvents._bound = true;
}

function setContractAddress(addr) {
  if (!addr || !ethers.utils.isAddress(addr)) {
    setStatus("请输入正确的合约地址");
    return;
  }
  if (!state.provider && getInjectedEthereum()) {
    try { state.provider = new ethers.providers.Web3Provider(getInjectedEthereum(), 'any'); } catch {}
  }
  state.contractAddress = ethers.utils.getAddress(addr);
  const reader = state.signer || state.provider;
  state.contract = new ethers.Contract(state.contractAddress, state.abi, reader);
  setStatus(`已设置合约：${state.contractAddress}`);
  state.page = { start: 0, step: 10, finished: false };
  $("messageList").innerHTML = "";
  unsubscribeEvents();
  subscribeEvents();
  startPolling();
  loadConfigHints().then(async () => {
    try { state.lastTotal = ethers.BigNumber.from(await state.contract.total()); } catch {}
    await loadNextPage();
  }).catch(console.error);
}

async function loadConfigHints() {
  if (!state.contract) return;
  const [fee, rate, maxLen] = await Promise.all([
    state.contract.postFee(),
    state.contract.rateLimitSeconds(),
    state.contract.maxContentLengthBytes(),
  ]);
  $("configHints").textContent = `发帖费：${fee} wei，限速：${rate}s，最长：${maxLen} 字节`;
}

function renderMessageItem(m) {
  const li = document.createElement("li");
  li.className = "item";
  const you = state.account && state.account.toLowerCase() === m.author.toLowerCase();
  const deleted = m.isDeleted;
  const content = deleted ? "[已删除]" : m.content;
  li.innerHTML = `
    <div class="content">${escapeHtml(content)}</div>
    <div class="meta">
      <span>#${m.id}</span>
      <span>作者：${fmtAddr(m.author)}</span>
      <span>时间：${new Date(Number(m.createdAt) * 1000).toLocaleString()}</span>
      ${m.parentId && Number(m.parentId) !== 0 ? `<span>回复于 #${m.parentId}</span>` : ""}
    </div>
  `;
  const actions = document.createElement("div");
  actions.className = "actions";
  if (you && !deleted) {
    const editBtn = document.createElement("button");
    editBtn.textContent = "编辑";
    editBtn.onclick = async () => {
      const newContent = prompt("修改内容：", m.content);
      if (newContent == null) return;
      await txWrap(() => state.contract.connect(state.signer).edit(m.id, newContent));
      refreshFromStart();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.onclick = async () => {
      if (!confirm("确认删除该留言？")) return;
      await txWrap(() => state.contract.connect(state.signer).softDelete(m.id));
      refreshFromStart();
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
  }
  li.appendChild(actions);
  return li;
}

async function loadNextPage() {
  if (!state.contract || state.page.finished) return;
  const { start, step } = state.page;
  const list = await state.contract.getRange(start, step);
  if (list.length === 0) {
    state.page.finished = true;
    return;
  }
  list.forEach((m) => $("messageList").appendChild(renderMessageItem(m)));
  state.page.start += list.length;
}

function refreshFromStart() {
  state.page = { start: 0, step: 10, finished: false };
  $("messageList").innerHTML = "";
  loadNextPage();
}

async function postMessage() {
  if (!state.signer) {
    // 主动尝试连接，避免弹窗遮挡阻断流程
    await connectWallet();
    if (!state.signer) return;
  }
  const content = $("contentInput").value.trim();
  const parentIdStr = $("parentIdInput").value.trim();
  const parentId = parentIdStr ? ethers.BigNumber.from(parentIdStr) : ethers.BigNumber.from(0);
  if (!content) { alert("内容不能为空"); return; }
  const fee = await state.contract.postFee();
  await txWrap(() => state.contract.connect(state.signer).post(content, parentId, { value: fee }));
  $("contentInput").value = "";
  refreshFromStart();
}

async function txWrap(fn) {
  try {
    setStatus("交易发送中...");
    const tx = await fn();
    setStatus(`等待上链：${tx.hash}`);
    await tx.wait();
    setStatus("已上链");
  } catch (e) {
    console.error(e);
    setStatus(parseEthersError(e));
  }
}

function parseEthersError(e) {
  if (e && e.shortMessage) return e.shortMessage;
  if (e && e.message) return e.message;
  return "交易失败";
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Bind events
window.addEventListener("DOMContentLoaded", () => {
  $("connectBtn").onclick = connectWallet;
  $("setAddressBtn").onclick = () => setContractAddress($("contractAddress").value.trim());
  $("postBtn").onclick = postMessage;
  $("loadMoreBtn").onclick = loadNextPage;
  restoreConnectionIfAny();
});

// Events & polling
function subscribeEvents() {
  if (!state.contract) return;
  try {
    state.contract.on("MessagePosted", () => refreshFromStart());
    state.contract.on("MessageEdited", () => refreshFromStart());
    state.contract.on("MessageDeleted", () => refreshFromStart());
  } catch (e) {
    console.warn("事件监听不可用，使用轮询作为后备", e);
  }
}

function unsubscribeEvents() {
  try { state.contract?.removeAllListeners?.(); } catch {}
}

function startPolling(intervalMs = 5000) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (!state.contract) return;
  state.pollTimer = setInterval(async () => {
    try {
      const t = ethers.BigNumber.from(await state.contract.total());
      if (!t.eq(state.lastTotal)) {
        state.lastTotal = t;
        refreshFromStart();
      }
    } catch {}
  }, intervalMs);
}


