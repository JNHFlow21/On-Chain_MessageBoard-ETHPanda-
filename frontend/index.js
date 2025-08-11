// Minimal frontend for MessageBoard
// Requires MetaMask and Ethers v6 UMD via CDN

const state = {
  provider: null,
  signer: null,
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
  lastTotal: 0n,
  pollTimer: null,
};

const $ = (id) => document.getElementById(id);
const fmtAddr = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : "";
const setStatus = (t) => ($("statusBox").textContent = t);

async function ensureProvider() {
  if (!window.ethereum) throw new Error("请安装 MetaMask 扩展");
  if (!state.provider) state.provider = new ethers.BrowserProvider(window.ethereum);
  return state.provider;
}

async function connectWallet() {
  await ensureProvider();
  try {
    // 直接调用 MetaMask 原生 API，确保触发弹窗
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) throw new Error('未授权账户');
    state.account = ethers.getAddress(accounts[0]);
    state.signer = await state.provider.getSigner();
    setStatus(`已连接：${fmtAddr(state.account)}`);
    bindEthereumEvents();
  } catch (e) {
    console.error(e);
    alert(parseEthersError(e));
  }
}

async function restoreConnectionIfAny() {
  if (!window.ethereum) return;
  await ensureProvider();
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      state.account = ethers.getAddress(accounts[0]);
      state.signer = await state.provider.getSigner();
      setStatus(`已连接：${fmtAddr(state.account)}`);
      bindEthereumEvents();
    }
  } catch {}
}

function bindEthereumEvents() {
  if (!window.ethereum || bindEthereumEvents._bound) return;
  window.ethereum.on?.('accountsChanged', async (accounts) => {
    if (!accounts || accounts.length === 0) {
      state.account = null; state.signer = null;
      setStatus('钱包未连接');
      return;
    }
    state.account = ethers.getAddress(accounts[0]);
    state.signer = await state.provider.getSigner();
    setStatus(`已连接：${fmtAddr(state.account)}`);
    refreshFromStart();
  });
  window.ethereum.on?.('chainChanged', () => {
    // 切换网络后刷新读取
    refreshFromStart();
  });
  bindEthereumEvents._bound = true;
}

function setContractAddress(addr) {
  if (!addr || !ethers.isAddress(addr)) {
    alert("请输入正确的合约地址");
    return;
  }
  state.contractAddress = ethers.getAddress(addr);
  state.contract = new ethers.Contract(state.contractAddress, state.abi, state.signer || state.provider);
  setStatus(`已设置合约：${state.contractAddress}`);
  state.page = { start: 0, step: 10, finished: false };
  $("messageList").innerHTML = "";
  unsubscribeEvents();
  subscribeEvents();
  startPolling();
  loadConfigHints().then(async () => {
    try { state.lastTotal = BigInt(await state.contract.total()); } catch {}
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
    alert("请先连接钱包");
    return;
  }
  const content = $("contentInput").value.trim();
  const parentIdStr = $("parentIdInput").value.trim();
  const parentId = parentIdStr ? BigInt(parentIdStr) : 0n;
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
    alert(parseEthersError(e));
    setStatus("交易失败");
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
      const t = BigInt(await state.contract.total());
      if (t !== state.lastTotal) {
        state.lastTotal = t;
        refreshFromStart();
      }
    } catch {}
  }, intervalMs);
}


