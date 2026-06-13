importScripts("core.js");

const core = globalThis.ClaudeSwitcherCore;
const { constants } = core;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
    return true;
});

async function handleMessage(message = {}) {
    switch (message.action) {
        case "getState":
            return getState();
        case "captureProfile":
            return captureProfile(message.label);
        case "switchProfile":
            return switchProfile(message.id);
        case "deleteProfile":
            return deleteProfile(message.id);
        case "exportProfiles":
            return exportProfiles(message.id ? [message.id] : null);
        case "importProfiles":
            return importProfiles(message.text);
        case "diagnose":
            return diagnoseCookieAccess();
        case "openClaude":
            return openClaude();
        default:
            throw new Error(`未知操作: ${message.action || ""}`);
    }
}

function formatError(error) {
    if (!error) return "未知错误";
    if (typeof error === "string") return error;
    if (error.message) return error.message;
    return String(error);
}

function callChrome(fn, ...args) {
    return new Promise((resolve, reject) => {
        try {
            fn(...args, (result) => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                resolve(result);
            });
        } catch (error) {
            reject(error);
        }
    });
}

function storageGet(keys) {
    return callChrome(chrome.storage.local.get.bind(chrome.storage.local), keys);
}

function storageSet(values) {
    return callChrome(chrome.storage.local.set.bind(chrome.storage.local), values);
}

async function loadProfiles() {
    const data = await storageGet([constants.PROFILE_KEY, constants.CURRENT_PROFILE_KEY]);
    const profiles = core.normalizeProfiles(data[constants.PROFILE_KEY] || []);
    const currentProfileId = profiles.some((profile) => profile.id === data[constants.CURRENT_PROFILE_KEY])
        ? data[constants.CURRENT_PROFILE_KEY]
        : (profiles[0]?.id || "");
    return { profiles, currentProfileId };
}

async function saveProfiles(profiles, currentProfileId) {
    const normalized = core.normalizeProfiles(profiles);
    const nextCurrentProfileId = normalized.some((profile) => profile.id === currentProfileId)
        ? currentProfileId
        : (normalized[0]?.id || "");
    await storageSet({
        [constants.PROFILE_KEY]: normalized,
        [constants.CURRENT_PROFILE_KEY]: nextCurrentProfileId
    });
    return { profiles: normalized, currentProfileId: nextCurrentProfileId };
}

async function getState() {
    const { profiles, currentProfileId } = await loadProfiles();
    return {
        version: constants.VERSION,
        currentProfileId,
        profiles: core.profilesMeta(profiles)
    };
}

async function safeCookieGetAll(details) {
    try {
        const result = await callChrome(chrome.cookies.getAll.bind(chrome.cookies), details);
        return Array.isArray(result) ? result : [];
    } catch (_error) {
        return [];
    }
}

async function listClaudeCookies() {
    const queries = [
        { url: constants.HOME_URL },
        { domain: constants.TARGET_HOST },
        { domain: `.${constants.TARGET_HOST}` },
        { url: constants.HOME_URL, partitionKey: { topLevelSite: constants.HOME_URL.slice(0, -1) } }
    ];
    const collected = [];
    for (const details of queries) {
        collected.push(...await safeCookieGetAll(details));
    }
    return core.normalizeCookieList(collected);
}

async function captureProfile(label) {
    const cookies = await listClaudeCookies();
    const { profiles, currentProfileId } = await loadProfiles();
    const cleanLabel = String(label || "").trim() || `Claude 账号 ${profiles.length + 1}`;
    const existing = profiles.find((profile) => profile.label === cleanLabel);
    const profile = core.createProfile(cleanLabel, cookies, existing?.id);
    const nextProfiles = existing
        ? profiles.map((item) => item.id === existing.id ? profile : item)
        : [...profiles, profile];
    await saveProfiles(nextProfiles, profile.id || currentProfileId);
    return {
        profile: core.profileMeta(profile),
        authCookieNames: core.authCookieNames(profile.cookies)
    };
}

async function deleteCurrentClaudeCookies() {
    const cookies = await listClaudeCookies();
    let deleted = 0;
    for (const cookie of cookies) {
        await callChrome(chrome.cookies.remove.bind(chrome.cookies), core.buildRemoveDetails(cookie));
        deleted += 1;
    }
    return deleted;
}

async function setProfileCookies(profile) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = [];
    const applied = [];

    for (const cookie of profile.cookies) {
        if (!cookie.session && typeof cookie.expirationDate === "number" && cookie.expirationDate <= nowSeconds) {
            expired.push(cookie.name);
            continue;
        }
        await callChrome(chrome.cookies.set.bind(chrome.cookies), core.buildSetDetails(cookie));
        applied.push(cookie.name);
    }

    return { expired, applied };
}

async function verifyProfileCookies(profile) {
    const currentCookies = await listClaudeCookies();
    const currentMap = new Map(currentCookies.map((cookie) => [core.cookieKey(cookie), cookie]));
    const missing = profile.cookies.filter((cookie) => {
        const saved = currentMap.get(core.cookieKey(cookie));
        return !saved || saved.value !== cookie.value;
    });
    return {
        hasAuth: core.hasAuthCookie(currentCookies),
        missing: missing.map((cookie) => cookie.name),
        cookieCount: currentCookies.length
    };
}

async function switchProfile(id) {
    const { profiles } = await loadProfiles();
    const profile = profiles.find((item) => item.id === id);
    if (!profile) throw new Error("未找到选中的账号。");
    if (!core.hasAuthCookie(profile.cookies)) {
        throw new Error(`「${profile.label}」缺少 sessionKey/sessionKeyV2，无法切换。请重新登录 Claude 后保存。`);
    }

    const deleted = await deleteCurrentClaudeCookies();
    const setResult = await setProfileCookies(profile);
    await saveProfiles(profiles, profile.id);
    const verification = await verifyProfileCookies(profile);
    const clientState = await clearClaudeClientState();
    const tabs = await refreshClaudeTabs();

    return {
        profile: core.profileMeta(profile),
        deleted,
        setResult,
        verification,
        clientState,
        tabs
    };
}

async function deleteProfile(id) {
    const { profiles, currentProfileId } = await loadProfiles();
    const nextProfiles = profiles.filter((profile) => profile.id !== id);
    const nextCurrent = currentProfileId === id ? (nextProfiles[0]?.id || "") : currentProfileId;
    const saved = await saveProfiles(nextProfiles, nextCurrent);
    return {
        currentProfileId: saved.currentProfileId,
        profiles: core.profilesMeta(saved.profiles)
    };
}

async function exportProfiles(ids) {
    const { profiles } = await loadProfiles();
    const selected = Array.isArray(ids) && ids.length
        ? profiles.filter((profile) => ids.includes(profile.id))
        : profiles;
    return JSON.stringify(core.exportData(selected), null, 2);
}

async function importProfiles(text) {
    const incoming = core.importProfilesFromJson(text);
    const { profiles, currentProfileId } = await loadProfiles();
    const map = new Map(profiles.map((profile) => [profile.id, profile]));
    let added = 0;
    let replaced = 0;

    for (const profile of incoming) {
        if (map.has(profile.id)) {
            replaced += 1;
        } else {
            added += 1;
        }
        map.set(profile.id, profile);
    }

    const saved = await saveProfiles(Array.from(map.values()), currentProfileId);
    return {
        added,
        replaced,
        total: saved.profiles.length,
        currentProfileId: saved.currentProfileId,
        profiles: core.profilesMeta(saved.profiles)
    };
}

async function diagnoseCookieAccess() {
    const cookies = await listClaudeCookies();
    return {
        ...core.diagnoseCookies(cookies),
        api: "chrome.cookies"
    };
}

async function clearClaudeClientState() {
    const result = {
        browsingData: false,
        injectedTabs: 0,
        errors: []
    };

    try {
        await callChrome(
            chrome.browsingData.remove.bind(chrome.browsingData),
            { origins: [constants.HOME_URL.slice(0, -1)] },
            {
                cacheStorage: true,
                indexedDB: true,
                localStorage: true,
                serviceWorkers: true,
                webSQL: true
            }
        );
        result.browsingData = true;
    } catch (error) {
        result.errors.push(`browsingData: ${formatError(error)}`);
    }

    try {
        const tabs = await getClaudeTabs();
        for (const tab of tabs) {
            if (!tab.id) continue;
            await callChrome(chrome.scripting.executeScript.bind(chrome.scripting), {
                target: { tabId: tab.id },
                func: () => {
                    try { localStorage.clear(); } catch (_error) {}
                    try { sessionStorage.clear(); } catch (_error) {}
                }
            });
            result.injectedTabs += 1;
        }
    } catch (error) {
        result.errors.push(`scripting: ${formatError(error)}`);
    }

    return result;
}

function getClaudeTabs() {
    return callChrome(chrome.tabs.query.bind(chrome.tabs), {
        url: ["https://claude.ai/*", "https://*.claude.ai/*"]
    });
}

async function refreshClaudeTabs() {
    const tabs = await getClaudeTabs();
    if (!tabs.length) {
        const tab = await callChrome(chrome.tabs.create.bind(chrome.tabs), { url: constants.HOME_URL });
        return { reloaded: 0, created: tab?.id ? 1 : 0 };
    }

    let reloaded = 0;
    for (const tab of tabs) {
        if (!tab.id) continue;
        await callChrome(chrome.tabs.update.bind(chrome.tabs), tab.id, {
            url: `${constants.HOME_URL}?claude_switcher_reload=${Date.now()}`
        });
        reloaded += 1;
    }
    return { reloaded, created: 0 };
}

async function openClaude() {
    const tabs = await getClaudeTabs();
    if (tabs[0]?.id) {
        await callChrome(chrome.tabs.update.bind(chrome.tabs), tabs[0].id, { active: true });
        if (tabs[0].windowId) {
            await callChrome(chrome.windows.update.bind(chrome.windows), tabs[0].windowId, { focused: true });
        }
        return { opened: false };
    }
    await callChrome(chrome.tabs.create.bind(chrome.tabs), { url: constants.HOME_URL });
    return { opened: true };
}
