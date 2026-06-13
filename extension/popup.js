const elements = {
    version: document.getElementById("version"),
    profileCount: document.getElementById("profileCount"),
    currentLabel: document.getElementById("currentLabel"),
    profileSelect: document.getElementById("profileSelect"),
    labelInput: document.getElementById("labelInput"),
    jsonArea: document.getElementById("jsonArea"),
    message: document.getElementById("message"),
    openClaude: document.getElementById("openClaude"),
    captureProfile: document.getElementById("captureProfile"),
    switchProfile: document.getElementById("switchProfile"),
    previousProfile: document.getElementById("previousProfile"),
    nextProfile: document.getElementById("nextProfile"),
    deleteProfile: document.getElementById("deleteProfile"),
    diagnose: document.getElementById("diagnose"),
    exportAll: document.getElementById("exportAll"),
    exportSelected: document.getElementById("exportSelected"),
    importProfiles: document.getElementById("importProfiles")
};

let state = {
    version: "",
    currentProfileId: "",
    profiles: []
};
let busy = false;

function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            if (!response || !response.ok) {
                reject(new Error(response?.error || "操作失败"));
                return;
            }
            resolve(response.data);
        });
    });
}

function setMessage(text, type = "") {
    elements.message.textContent = text;
    elements.message.className = `message ${type}`.trim();
}

function selectedProfileId() {
    return elements.profileSelect.value || state.currentProfileId || state.profiles[0]?.id || "";
}

function selectedProfile() {
    const id = selectedProfileId();
    return state.profiles.find((profile) => profile.id === id) || null;
}

function relativeProfile(delta) {
    if (!state.profiles.length) return null;
    const selectedId = selectedProfileId();
    const baseIndex = Math.max(0, state.profiles.findIndex((profile) => profile.id === selectedId));
    const nextIndex = (baseIndex + delta + state.profiles.length) % state.profiles.length;
    return state.profiles[nextIndex];
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_error) {
        elements.jsonArea.focus();
        elements.jsonArea.select();
        document.execCommand("copy");
    }
}

function render() {
    elements.version.textContent = `Extension v${state.version || ""}`;
    elements.profileCount.textContent = String(state.profiles.length);

    const current = state.profiles.find((profile) => profile.id === state.currentProfileId);
    elements.currentLabel.textContent = current ? current.label : "未选择";

    const previousValue = selectedProfileId();
    elements.profileSelect.innerHTML = "";
    state.profiles.forEach((profile, index) => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = `${index + 1}. ${profile.label}`;
        option.title = `${profile.cookieCount} cookies / ${profile.authCookieNames.join(", ")}`;
        elements.profileSelect.appendChild(option);
    });
    elements.profileSelect.value = state.profiles.some((profile) => profile.id === previousValue)
        ? previousValue
        : (state.currentProfileId || state.profiles[0]?.id || "");

    const hasSelection = Boolean(selectedProfile());
    elements.openClaude.disabled = busy;
    elements.captureProfile.disabled = busy;
    elements.diagnose.disabled = busy;
    elements.exportAll.disabled = busy;
    elements.importProfiles.disabled = busy;
    elements.switchProfile.disabled = busy || !hasSelection;
    elements.previousProfile.disabled = busy || !hasSelection;
    elements.nextProfile.disabled = busy || !hasSelection;
    elements.deleteProfile.disabled = busy || !hasSelection;
    elements.exportSelected.disabled = busy || !hasSelection;
}

async function refreshState() {
    state = await sendMessage({ action: "getState" });
    render();
}

async function runAction(fn) {
    setBusy(true);
    try {
        await fn();
    } catch (error) {
        setMessage(error.message || String(error), "error");
    } finally {
        setBusy(false);
    }
}

function setBusy(isBusy) {
    busy = isBusy;
    render();
}

elements.openClaude.addEventListener("click", () => runAction(async () => {
    await sendMessage({ action: "openClaude" });
    setMessage("已打开 Claude。", "success");
}));

elements.captureProfile.addEventListener("click", () => runAction(async () => {
    const label = elements.labelInput.value.trim();
    const result = await sendMessage({ action: "captureProfile", label });
    elements.labelInput.value = "";
    await refreshState();
    elements.profileSelect.value = result.profile.id;
    setMessage(`已保存「${result.profile.label}」，认证 Cookie: ${result.authCookieNames.join(", ")}。`, "success");
}));

elements.switchProfile.addEventListener("click", () => runAction(async () => {
    const profile = selectedProfile();
    if (!profile) throw new Error("请选择账号。");
    await switchToProfile(profile);
}));

elements.previousProfile.addEventListener("click", () => runAction(async () => {
    const profile = relativeProfile(-1);
    if (!profile) throw new Error("还没有保存账号。");
    await switchToProfile(profile);
}));

elements.nextProfile.addEventListener("click", () => runAction(async () => {
    const profile = relativeProfile(1);
    if (!profile) throw new Error("还没有保存账号。");
    await switchToProfile(profile);
}));

async function switchToProfile(profile) {
    const result = await sendMessage({ action: "switchProfile", id: profile.id });
    await refreshState();
    elements.profileSelect.value = result.profile.id;

    if (result.verification.missing.length) {
        setMessage(`已写入，但 ${result.verification.missing.length} 个 Cookie 未验证成功。`, "error");
    } else if (!result.verification.hasAuth) {
        setMessage("已写入，但未验证到 sessionKey/sessionKeyV2。", "error");
    } else {
        setMessage(`已切换到「${result.profile.label}」。Claude 标签页已刷新。`, "success");
    }
}

elements.deleteProfile.addEventListener("click", () => runAction(async () => {
    const profile = selectedProfile();
    if (!profile) throw new Error("请选择账号。");
    if (!confirm(`删除本地保存的「${profile.label}」？`)) return;
    await sendMessage({ action: "deleteProfile", id: profile.id });
    await refreshState();
    setMessage("已删除本地账号快照。", "success");
}));

elements.diagnose.addEventListener("click", () => runAction(async () => {
    const report = await sendMessage({ action: "diagnose" });
    const text = JSON.stringify(report, null, 2);
    elements.jsonArea.value = text;
    await copyText(text);
    setMessage(report.canSwitch
        ? `诊断通过：${report.authCookieNames.join(", ")}。报告已复制。`
        : "诊断失败：未读到 sessionKey/sessionKeyV2。报告已复制。",
        report.canSwitch ? "success" : "error");
}));

elements.exportAll.addEventListener("click", () => runAction(async () => {
    const text = await sendMessage({ action: "exportProfiles" });
    elements.jsonArea.value = text;
    await copyText(text);
    setMessage("已导出全部账号 JSON，并复制到剪贴板。", "success");
}));

elements.exportSelected.addEventListener("click", () => runAction(async () => {
    const profile = selectedProfile();
    if (!profile) throw new Error("请选择账号。");
    const text = await sendMessage({ action: "exportProfiles", id: profile.id });
    elements.jsonArea.value = text;
    await copyText(text);
    setMessage("已导出选中账号 JSON，并复制到剪贴板。", "success");
}));

elements.importProfiles.addEventListener("click", () => runAction(async () => {
    const text = elements.jsonArea.value.trim();
    if (!text) throw new Error("请先粘贴 JSON。");
    const result = await sendMessage({ action: "importProfiles", text });
    await refreshState();
    setMessage(`导入完成：新增 ${result.added}，覆盖 ${result.replaced}，总计 ${result.total}。`, "success");
}));

elements.profileSelect.addEventListener("change", render);

refreshState().catch((error) => {
    setMessage(error.message || String(error), "error");
});
