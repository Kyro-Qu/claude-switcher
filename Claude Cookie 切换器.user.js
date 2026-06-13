// ==UserScript==
// @name         Claude Cookie 切换器
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @description  本地保存 claude.ai 登录 Cookie 快照，并在家庭成员账号之间切换；自动排除 Cloudflare 风控 Cookie 并清理前端缓存。
// @author       froger
// @match        https://claude.ai/*
// @match        https://*.claude.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_cookie
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function(factory) {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory;
    }
    if (typeof window !== "undefined" && typeof document !== "undefined") {
        factory().run();
    }
})(function createClaudeCookieSwitcher(runtime = {}) {
    const constants = {
        HOME_URL: "https://claude.ai/",
        TARGET_HOST: "claude.ai",
        RELOAD_PARAM: "claude_switcher_reload",
        PROFILE_KEY: "claude_cookie_profiles_v1",
        CURRENT_PROFILE_KEY: "claude_current_profile_id",
        PANEL_STATE_KEY: "claude_panel_state_v1",
        EXPORT_VERSION: 1,
        AUTH_COOKIE_NAMES: ["sessionKey", "sessionKeyV2", "activitySessionId"],
        EXCLUDED_COOKIE_NAMES: ["cf_clearance", "__cf_bm", "_cfuvid", "__cflb", "__cfseq"]
    };

    const gm = {
        getValue: runtime.gm?.getValue || (typeof GM_getValue === "function" ? GM_getValue : ((_key, fallback) => fallback)),
        setValue: runtime.gm?.setValue || (typeof GM_setValue === "function" ? GM_setValue : (() => {})),
        deleteValue: runtime.gm?.deleteValue || (typeof GM_deleteValue === "function" ? GM_deleteValue : (() => {})),
        setClipboard: runtime.gm?.setClipboard || (typeof GM_setClipboard === "function" ? GM_setClipboard : (() => {})),
        registerMenuCommand: runtime.gm?.registerMenuCommand || (typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : (() => {})),
        cookie: runtime.gm?.cookie || (typeof GM_cookie !== "undefined" ? GM_cookie : null)
    };

    const documentObj = runtime.document || (typeof document !== "undefined" ? document : null);
    const windowObj = runtime.window || (typeof window !== "undefined" ? window : null);
    const locationObj = runtime.location || (typeof location !== "undefined" ? location : null);
    const localStorageObj = runtime.localStorage || getWindowObject("localStorage");
    const sessionStorageObj = runtime.sessionStorage || getWindowObject("sessionStorage");
    const indexedDBObj = runtime.indexedDB || getWindowObject("indexedDB");
    const cachesObj = runtime.caches || getWindowObject("caches");
    const navigatorObj = runtime.navigator || getWindowObject("navigator");
    const confirmFn = runtime.confirm || (typeof confirm === "function" ? confirm : (() => true));
    const promptFn = runtime.prompt || (typeof prompt === "function" ? prompt : (() => ""));
    const setTimeoutFn = runtime.setTimeout || (typeof setTimeout === "function" ? setTimeout : ((fn) => fn()));
    const clearTimeoutFn = runtime.clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : (() => {}));
    const nowFn = runtime.now || (() => Date.now());
    const uuidFn = runtime.uuid || createId;

    const state = {
        profiles: [],
        currentProfileId: "",
        selectedProfileId: "",
        panel: {
            top: "84px",
            right: "36px",
            minimized: false
        },
        busy: false
    };

    function createId() {
        const cryptoObj = runtime.crypto || (typeof crypto !== "undefined" ? crypto : null);
        if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
            return cryptoObj.randomUUID();
        }
        return `profile-${nowFn().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function getWindowObject(name) {
        try {
            return windowObj ? windowObj[name] : null;
        } catch (_error) {
            return null;
        }
    }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function formatError(error) {
        if (!error) return "未知错误";
        if (typeof error === "string") return error;
        if (error.message) return error.message;
        return String(error);
    }

    function byId(id) {
        return documentObj ? documentObj.getElementById(id) : null;
    }

    function query(selector) {
        return documentObj ? documentObj.querySelector(selector) : null;
    }

    function toast(message, type = "info", timeout = 3000) {
        const el = query(".claude-switcher-toast");
        if (!el) return;
        const prefix = type === "success" ? "成功" : (type === "error" ? "错误" : "提示");
        el.textContent = `${prefix}: ${message}`;
        el.dataset.type = type;
        el.classList.add("show");
        clearTimeoutFn(toast.timer);
        toast.timer = setTimeoutFn(() => el.classList.remove("show"), timeout);
    }

    function setBusy(isBusy, message = "") {
        state.busy = Boolean(isBusy);
        const title = byId("claude-switcher-title");
        if (title) {
            title.textContent = state.busy ? (message || "处理中...") : "Claude 账号助手";
        }
        const panel = byId("claude-cookie-switcher-panel");
        if (panel) {
            panel.dataset.busy = state.busy ? "true" : "false";
        }
    }

    function loadState() {
        const savedProfiles = gm.getValue(constants.PROFILE_KEY, []);
        state.profiles = Array.isArray(savedProfiles) ? savedProfiles.map(normalizeProfile).filter(Boolean) : [];
        state.currentProfileId = String(gm.getValue(constants.CURRENT_PROFILE_KEY, "") || "");

        if (!state.profiles.some((profile) => profile.id === state.currentProfileId)) {
            state.currentProfileId = "";
        }

        const panel = gm.getValue(constants.PANEL_STATE_KEY, null);
        if (panel && typeof panel === "object") {
            state.panel = {
                top: typeof panel.top === "string" ? panel.top : state.panel.top,
                left: typeof panel.left === "string" ? panel.left : panel.left,
                right: typeof panel.right === "string" ? panel.right : state.panel.right,
                minimized: Boolean(panel.minimized)
            };
        }
    }

    function saveProfiles() {
        gm.setValue(constants.PROFILE_KEY, state.profiles);
        gm.setValue(constants.CURRENT_PROFILE_KEY, state.currentProfileId || "");
        updateUI();
    }

    function savePanelState(nextPanel = state.panel) {
        state.panel = {
            top: nextPanel.top || "84px",
            left: nextPanel.left || "",
            right: nextPanel.right || "",
            minimized: Boolean(nextPanel.minimized)
        };
        gm.setValue(constants.PANEL_STATE_KEY, state.panel);
    }

    function normalizeProfile(profile) {
        if (!profile || typeof profile !== "object") return null;
        const cookies = normalizeCookieList(Array.isArray(profile.cookies) ? profile.cookies : []);
        if (!cookies.length) return null;

        return {
            id: String(profile.id || uuidFn()),
            label: String(profile.label || "Claude 账号").trim() || "Claude 账号",
            capturedAt: String(profile.capturedAt || new Date(nowFn()).toISOString()),
            cookies
        };
    }

    function normalizeCookie(cookie) {
        if (!cookie || typeof cookie !== "object") return null;
        const name = String(cookie.name || "");
        const value = typeof cookie.value === "string" ? cookie.value : "";
        const domain = String(cookie.domain || "").toLowerCase();
        const path = String(cookie.path || "/");

        if (!name || !domain) return null;

        const normalized = {
            name,
            value,
            domain,
            path: path.startsWith("/") ? path : `/${path}`,
            secure: Boolean(cookie.secure),
            httpOnly: Boolean(cookie.httpOnly),
            sameSite: typeof cookie.sameSite === "string" ? cookie.sameSite : undefined,
            session: Boolean(cookie.session),
            hostOnly: Boolean(cookie.hostOnly)
        };

        if (typeof cookie.expirationDate === "number" && Number.isFinite(cookie.expirationDate)) {
            normalized.expirationDate = cookie.expirationDate;
        }
        if (cookie.partitionKey && typeof cookie.partitionKey === "object") {
            normalized.partitionKey = cloneJson(cookie.partitionKey);
        }
        if (typeof cookie.firstPartyDomain === "string" && cookie.firstPartyDomain) {
            normalized.firstPartyDomain = cookie.firstPartyDomain;
        }

        return normalized;
    }

    function normalizeCookieList(cookies) {
        const map = new Map();
        cookies.map(normalizeCookie).filter(Boolean).forEach((cookie) => {
            if (shouldManageCookie(cookie)) {
                map.set(cookieKey(cookie), cookie);
            }
        });
        return Array.from(map.values()).sort((a, b) => {
            const left = `${a.domain}|${a.path}|${a.name}`;
            const right = `${b.domain}|${b.path}|${b.name}`;
            return left.localeCompare(right);
        });
    }

    function isClaudeCookie(cookie) {
        const domain = String(cookie?.domain || "").toLowerCase();
        return domain === constants.TARGET_HOST || domain === `.${constants.TARGET_HOST}`;
    }

    function isExcludedCookie(cookie) {
        const name = String(cookie?.name || "").toLowerCase();
        return constants.EXCLUDED_COOKIE_NAMES.includes(name) || name.startsWith("cf_chl_");
    }

    function shouldManageCookie(cookie) {
        return isClaudeCookie(cookie) && !isExcludedCookie(cookie);
    }

    function cookieKey(cookie) {
        return [
            cookie.name,
            cookie.domain,
            cookie.path || "/",
            JSON.stringify(cookie.partitionKey || {})
        ].join("|");
    }

    function hasAuthCookie(cookies) {
        return cookies.some((cookie) => constants.AUTH_COOKIE_NAMES.includes(cookie.name));
    }

    function getCurrentProfile() {
        return state.profiles.find((profile) => profile.id === state.currentProfileId) || null;
    }

    function getSelectedProfile() {
        const select = byId("claude-profile-select");
        const selectedId = state.selectedProfileId || (select && select.value) || "";
        if (selectedId) {
            return state.profiles.find((profile) => profile.id === selectedId) || null;
        }
        return getCurrentProfile() || state.profiles[0] || null;
    }

    function selectedIndex() {
        const profile = getSelectedProfile();
        if (!profile) return -1;
        return state.profiles.findIndex((item) => item.id === profile.id);
    }

    function normalizeIndex(index, total) {
        if (!total) return -1;
        if (index < 0) return total - 1;
        if (index >= total) return 0;
        return index;
    }

    function resolveRelativeIndex(delta) {
        if (!state.profiles.length) return -1;
        const base = state.currentProfileId
            ? state.profiles.findIndex((profile) => profile.id === state.currentProfileId)
            : selectedIndex();
        return normalizeIndex((base >= 0 ? base : 0) + delta, state.profiles.length);
    }

    function cookieUrl(cookie) {
        const domain = String(cookie?.domain || constants.TARGET_HOST).replace(/^\./, "") || constants.TARGET_HOST;
        const path = String(cookie?.path || "/");
        return `https://${domain}${path.startsWith("/") ? path : `/${path}`}`;
    }

    function runCookieCall(method, details, callbackAdapter) {
        return new Promise((resolve, reject) => {
            if (!gm.cookie || typeof gm.cookie[method] !== "function") {
                reject(new Error("当前 Tampermonkey 不支持 GM_cookie，请安装或启用 Tampermonkey Beta 的 Cookie API。"));
                return;
            }

            let settled = false;
            const settle = (resolver, value) => {
                if (settled) return;
                settled = true;
                resolver(value);
            };

            try {
                const result = gm.cookie[method](details, (...args) => {
                    callbackAdapter(args, (value) => settle(resolve, value), (error) => settle(reject, error));
                });
                if (result && typeof result.then === "function") {
                    result.then((value) => settle(resolve, value), (error) => settle(reject, error));
                } else if (method !== "list" && gm.cookie[method].length < 2) {
                    settle(resolve);
                }
            } catch (error) {
                settle(reject, error);
            }
        });
    }

    function cookieList(details) {
        return runCookieCall("list", details, (args, resolve, reject) => {
            const [cookies, error] = args;
            if (error) {
                reject(error);
                return;
            }
            if (Array.isArray(cookies)) {
                resolve(cookies);
                return;
            }
            resolve([]);
        });
    }

    function cookieSet(details) {
        return runCookieCall("set", details, (args, resolve, reject) => {
            const [error] = args;
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    }

    function cookieDelete(details) {
        return runCookieCall("delete", details, (args, resolve, reject) => {
            const [error] = args;
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    }

    async function listClaudeCookies() {
        let cookies = [];
        try {
            cookies = await cookieList({ url: constants.HOME_URL, partitionKey: {} });
        } catch (error) {
            cookies = await cookieList({ url: constants.HOME_URL });
        }

        if (!cookies.length) {
            try {
                cookies = await cookieList({ url: constants.HOME_URL });
            } catch (_error) {
                // Keep the original empty result if the fallback is unavailable.
            }
        }

        return normalizeCookieList(cookies);
    }

    function buildSetDetails(cookie) {
        const details = {
            url: cookieUrl(cookie),
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || "/",
            secure: Boolean(cookie.secure),
            httpOnly: Boolean(cookie.httpOnly)
        };

        if (!cookie.hostOnly && cookie.domain) {
            details.domain = cookie.domain;
        }
        if (cookie.sameSite) {
            details.sameSite = cookie.sameSite;
        }
        if (!cookie.session && typeof cookie.expirationDate === "number") {
            details.expirationDate = cookie.expirationDate;
        }
        if (cookie.partitionKey) {
            details.partitionKey = cloneJson(cookie.partitionKey);
        }
        if (cookie.firstPartyDomain) {
            details.firstPartyDomain = cookie.firstPartyDomain;
        }

        return details;
    }

    function buildDeleteDetails(cookie) {
        const details = {
            url: cookieUrl(cookie),
            name: cookie.name
        };
        if (cookie.partitionKey) {
            details.partitionKey = cloneJson(cookie.partitionKey);
        }
        if (cookie.firstPartyDomain) {
            details.firstPartyDomain = cookie.firstPartyDomain;
        }
        return details;
    }

    async function deleteCurrentClaudeCookies() {
        const cookies = await listClaudeCookies();
        for (const cookie of cookies) {
            await cookieDelete(buildDeleteDetails(cookie));
        }
        return cookies.length;
    }

    async function setProfileCookies(profile) {
        const nowSeconds = Math.floor(nowFn() / 1000);
        const expired = [];
        const applied = [];

        for (const cookie of profile.cookies) {
            if (!cookie.session && typeof cookie.expirationDate === "number" && cookie.expirationDate <= nowSeconds) {
                expired.push(cookie.name);
                continue;
            }
            await cookieSet(buildSetDetails(cookie));
            applied.push(cookie);
        }

        return { expired, applied };
    }

    async function verifyProfileCookies(profile) {
        const currentCookies = await listClaudeCookies();
        const currentMap = new Map(currentCookies.map((cookie) => [cookieKey(cookie), cookie]));
        const missing = profile.cookies.filter((cookie) => {
            const saved = currentMap.get(cookieKey(cookie));
            return !saved || saved.value !== cookie.value;
        });

        return {
            missing,
            hasAuth: hasAuthCookie(currentCookies),
            currentCookies
        };
    }

    async function clearClaudeClientState() {
        const result = {
            localStorage: false,
            sessionStorage: false,
            caches: 0,
            indexedDB: 0,
            serviceWorkers: 0,
            errors: []
        };

        try {
            if (localStorageObj && typeof localStorageObj.clear === "function") {
                localStorageObj.clear();
                result.localStorage = true;
            }
        } catch (error) {
            result.errors.push(`localStorage: ${formatError(error)}`);
        }

        try {
            if (sessionStorageObj && typeof sessionStorageObj.clear === "function") {
                sessionStorageObj.clear();
                result.sessionStorage = true;
            }
        } catch (error) {
            result.errors.push(`sessionStorage: ${formatError(error)}`);
        }

        try {
            if (cachesObj && typeof cachesObj.keys === "function" && typeof cachesObj.delete === "function") {
                const keys = await cachesObj.keys();
                for (const key of keys) {
                    if (await cachesObj.delete(key)) {
                        result.caches += 1;
                    }
                }
            }
        } catch (error) {
            result.errors.push(`Cache: ${formatError(error)}`);
        }

        try {
            if (indexedDBObj && typeof indexedDBObj.databases === "function" && typeof indexedDBObj.deleteDatabase === "function") {
                const databases = await indexedDBObj.databases();
                for (const database of databases || []) {
                    if (!database || !database.name) continue;
                    await deleteDatabase(database.name);
                    result.indexedDB += 1;
                }
            }
        } catch (error) {
            result.errors.push(`IndexedDB: ${formatError(error)}`);
        }

        try {
            const serviceWorker = navigatorObj && navigatorObj.serviceWorker;
            if (serviceWorker && typeof serviceWorker.getRegistrations === "function") {
                const registrations = await serviceWorker.getRegistrations();
                for (const registration of registrations || []) {
                    if (registration && typeof registration.unregister === "function") {
                        await registration.unregister();
                        result.serviceWorkers += 1;
                    }
                }
            }
        } catch (error) {
            result.errors.push(`ServiceWorker: ${formatError(error)}`);
        }

        return result;
    }

    function deleteDatabase(name) {
        return new Promise((resolve) => {
            try {
                const request = indexedDBObj.deleteDatabase(name);
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
                request.onblocked = () => resolve(false);
            } catch (_error) {
                resolve(false);
            }
        });
    }

    async function captureCurrentProfile(labelFromCaller) {
        if (state.busy) return null;
        setBusy(true, "读取 Cookie...");

        try {
            const cookies = await listClaudeCookies();
            if (!cookies.length) {
                toast("未读取到 claude.ai Cookie。请确认已登录 Claude，并使用支持 HttpOnly 的 Tampermonkey Beta。", "error", 6000);
                return null;
            }

            let label = labelFromCaller;
            if (typeof label !== "string") {
                const defaultLabel = `Claude 账号 ${state.profiles.length + 1}`;
                label = promptFn("请输入这个 Claude 账号的昵称：", defaultLabel);
            }
            if (label === null || label === undefined) return null;
            label = String(label).trim();
            if (!label) {
                toast("账号昵称不能为空。", "error");
                return null;
            }

            const existingIndex = state.profiles.findIndex((profile) => profile.label === label);
            if (existingIndex >= 0 && typeof labelFromCaller !== "string") {
                const ok = confirmFn(`已存在名为「${label}」的账号，是否覆盖它？`);
                if (!ok) return null;
            }

            const profile = {
                id: existingIndex >= 0 ? state.profiles[existingIndex].id : uuidFn(),
                label,
                capturedAt: new Date(nowFn()).toISOString(),
                cookies
            };

            if (existingIndex >= 0) {
                state.profiles.splice(existingIndex, 1, profile);
            } else {
                state.profiles.push(profile);
            }
            state.currentProfileId = profile.id;
            state.selectedProfileId = profile.id;
            saveProfiles();

            if (hasAuthCookie(cookies)) {
                toast(`已保存「${profile.label}」，共 ${cookies.length} 个 Cookie。`, "success");
            } else {
                toast("已保存 Cookie，但未发现 sessionKey/sessionKeyV2。若无法切换，请启用 Tampermonkey Beta 的 HttpOnly Cookie 访问后重新保存。", "info", 7000);
            }
            return profile;
        } catch (error) {
            toast(`保存失败: ${formatError(error)}`, "error", 7000);
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function switchToProfile(profileOrIndex) {
        if (state.busy) return false;

        const profile = typeof profileOrIndex === "number"
            ? state.profiles[normalizeIndex(profileOrIndex, state.profiles.length)]
            : profileOrIndex;

        if (!profile) {
            toast("没有可切换的账号，请先保存当前登录账号。", "error");
            return false;
        }

        if (!profile.cookies.length) {
            toast("该账号没有可用 Cookie。", "error");
            return false;
        }

        setBusy(true, "切换账号...");
        try {
            await deleteCurrentClaudeCookies();
            const result = await setProfileCookies(profile);
            state.currentProfileId = profile.id;
            state.selectedProfileId = profile.id;
            saveProfiles();

            const verification = await verifyProfileCookies(profile);
            if (result.expired.length) {
                toast(`已跳过 ${result.expired.length} 个过期 Cookie，可能需要重新登录保存。`, "info", 6000);
            } else if (verification.missing.length) {
                toast(`已切换，但有 ${verification.missing.length} 个 Cookie 未成功写入。请检查 Tampermonkey Cookie 权限。`, "info", 7000);
            } else if (!verification.hasAuth) {
                toast("已写入 Cookie，但未检测到 sessionKey/sessionKeyV2。可能需要重新登录并重新保存。", "info", 7000);
            } else {
                toast(`已切换到「${profile.label}」。`, "success");
            }

            const clientState = await clearClaudeClientState();
            if (clientState.errors.length) {
                toast(`已写入 Cookie，但部分前端缓存清理失败: ${clientState.errors.join("；")}`, "info", 8000);
            }

            setTimeoutFn(() => redirectHome(true), 800);
            return true;
        } catch (error) {
            toast(`切换失败: ${formatError(error)}`, "error", 7000);
            return false;
        } finally {
            setBusy(false);
        }
    }

    function redirectHome(forceReload = false) {
        if (locationObj && typeof locationObj.replace === "function") {
            if (forceReload) {
                locationObj.replace(`${constants.HOME_URL}?${constants.RELOAD_PARAM}=${nowFn()}`);
                return;
            }
            locationObj.replace(constants.HOME_URL);
        }
    }

    function removeSelectedProfile() {
        const profile = getSelectedProfile();
        if (!profile) {
            toast("没有可删除的账号。", "error");
            return false;
        }
        if (!confirmFn(`删除本地保存的「${profile.label}」？这不会退出当前网页登录。`)) {
            return false;
        }

        state.profiles = state.profiles.filter((item) => item.id !== profile.id);
        if (state.currentProfileId === profile.id) {
            state.currentProfileId = state.profiles[0]?.id || "";
        }
        state.selectedProfileId = state.currentProfileId || state.profiles[0]?.id || "";
        saveProfiles();
        toast("已删除本地账号快照。", "success");
        return true;
    }

    function exportData(profiles = state.profiles) {
        return {
            version: constants.EXPORT_VERSION,
            target: constants.HOME_URL,
            exportedAt: new Date(nowFn()).toISOString(),
            profiles: profiles.map((profile) => cloneJson(profile))
        };
    }

    function copyExport(profiles = state.profiles, successMessage = "已复制 JSON 备份。") {
        const data = JSON.stringify(exportData(profiles), null, 2);
        gm.setClipboard(data, "text");
        toast(successMessage, "success");
        return data;
    }

    function importProfilesFromJson(rawText) {
        const parsed = JSON.parse(String(rawText || ""));
        const incoming = Array.isArray(parsed) ? parsed : parsed.profiles;
        if (!Array.isArray(incoming)) {
            throw new Error("JSON 中未找到 profiles 数组。");
        }

        const before = state.profiles.length;
        let added = 0;
        let replaced = 0;
        const byId = new Map(state.profiles.map((profile) => [profile.id, profile]));

        incoming.forEach((item) => {
            const profile = normalizeProfile(item);
            if (!profile) return;
            if (byId.has(profile.id)) {
                byId.set(profile.id, profile);
                replaced += 1;
            } else {
                byId.set(profile.id, profile);
                added += 1;
            }
        });

        state.profiles = Array.from(byId.values());
        if (!state.profiles.some((profile) => profile.id === state.currentProfileId)) {
            state.currentProfileId = state.profiles[0]?.id || "";
        }
        state.selectedProfileId = state.currentProfileId || state.profiles[0]?.id || "";
        saveProfiles();

        return {
            before,
            after: state.profiles.length,
            added,
            replaced
        };
    }

    function importFromModal() {
        const textarea = byId("claude-import-area");
        if (!textarea || !textarea.value.trim()) {
            toast("请先粘贴 JSON 备份。", "error");
            return;
        }

        try {
            const result = importProfilesFromJson(textarea.value);
            closeModal("claude-import-modal");
            textarea.value = "";
            toast(`导入完成，新增 ${result.added} 个，覆盖 ${result.replaced} 个，当前总计 ${result.after} 个。`, "success");
        } catch (error) {
            toast(`导入失败: ${formatError(error)}`, "error", 7000);
        }
    }

    function openModal(id) {
        const modal = byId(id);
        if (modal) modal.classList.add("show");
    }

    function closeModal(id) {
        const modal = byId(id);
        if (modal) modal.classList.remove("show");
    }

    function updateUI() {
        const totalEl = byId("claude-profile-total");
        const currentEl = byId("claude-current-label");
        const select = byId("claude-profile-select");

        if (totalEl) totalEl.textContent = String(state.profiles.length);

        const current = getCurrentProfile();
        if (currentEl) {
            currentEl.textContent = current ? current.label : "未选择";
            currentEl.title = current ? current.capturedAt : "";
        }

        if (select) {
            const selectedValue = state.selectedProfileId || state.currentProfileId || select.value;
            select.innerHTML = "";
            state.profiles.forEach((profile, index) => {
                const option = documentObj.createElement("option");
                option.value = profile.id;
                option.textContent = `${index + 1}. ${profile.label}`;
                option.title = `${profile.cookies.length} cookies / ${profile.capturedAt}`;
                select.appendChild(option);
            });
            const nextSelectedValue = state.profiles.some((profile) => profile.id === selectedValue)
                ? selectedValue
                : (state.currentProfileId || state.profiles[0]?.id || "");
            select.value = nextSelectedValue;
            state.selectedProfileId = nextSelectedValue;
        }

        const copyButton = byId("claude-copy-current");
        if (copyButton) copyButton.disabled = !getSelectedProfile();
        const deleteButton = byId("claude-delete-profile");
        if (deleteButton) deleteButton.disabled = !getSelectedProfile();
        const switchButton = byId("claude-switch-selected");
        if (switchButton) switchButton.disabled = !getSelectedProfile();
    }

    function createUI() {
        if (!documentObj || !documentObj.body || !documentObj.head) return;
        if (byId("claude-cookie-switcher-panel")) return;

        const style = documentObj.createElement("style");
        style.textContent = `
            #claude-cookie-switcher-panel,
            #claude-cookie-switcher-min {
                --ccs-bg: rgba(23, 26, 30, 0.9);
                --ccs-border: rgba(255, 255, 255, 0.14);
                --ccs-text: #f6f4ef;
                --ccs-muted: rgba(246, 244, 239, 0.64);
                --ccs-accent: #d9822b;
                color: var(--ccs-text);
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                letter-spacing: 0;
            }
            #claude-cookie-switcher-panel {
                position: fixed;
                z-index: 2147483646;
                width: 310px;
                background: var(--ccs-bg);
                border: 1px solid var(--ccs-border);
                border-radius: 8px;
                box-shadow: 0 16px 42px rgba(0, 0, 0, 0.36);
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                overflow: hidden;
                user-select: none;
            }
            #claude-cookie-switcher-panel[data-busy="true"] button,
            #claude-cookie-switcher-panel[data-busy="true"] select {
                opacity: 0.68;
            }
            .ccs-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 12px 14px;
                border-bottom: 1px solid var(--ccs-border);
                cursor: move;
            }
            .ccs-title-wrap {
                min-width: 0;
            }
            #claude-switcher-title {
                display: block;
                font-size: 14px;
                font-weight: 700;
                line-height: 1.25;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .ccs-subtitle {
                display: block;
                margin-top: 2px;
                color: var(--ccs-muted);
                font-size: 11px;
                line-height: 1.25;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .ccs-min-btn {
                width: 28px;
                height: 28px;
                border-radius: 6px;
                border: 1px solid var(--ccs-border);
                background: rgba(255, 255, 255, 0.08);
                color: var(--ccs-text);
                cursor: pointer;
                font-size: 16px;
                line-height: 1;
            }
            .ccs-body {
                padding: 14px;
            }
            .ccs-status {
                display: grid;
                grid-template-columns: 1fr auto;
                gap: 10px;
                align-items: center;
                margin-bottom: 12px;
            }
            .ccs-current {
                min-width: 0;
            }
            .ccs-current strong {
                display: block;
                font-size: 13px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .ccs-current span {
                color: var(--ccs-muted);
                font-size: 11px;
            }
            .ccs-count {
                min-width: 44px;
                padding: 6px 8px;
                border: 1px solid rgba(217, 130, 43, 0.35);
                border-radius: 6px;
                text-align: center;
                color: #ffd6a8;
                background: rgba(217, 130, 43, 0.13);
                font-weight: 700;
            }
            .ccs-select {
                width: 100%;
                min-height: 36px;
                margin-bottom: 12px;
                padding: 0 10px;
                box-sizing: border-box;
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 6px;
                color: var(--ccs-text);
                background: rgba(0, 0, 0, 0.32);
                outline: none;
            }
            .ccs-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }
            .ccs-btn {
                min-height: 36px;
                padding: 0 10px;
                border-radius: 6px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                color: var(--ccs-text);
                background: rgba(255, 255, 255, 0.08);
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .ccs-btn:hover {
                background: rgba(255, 255, 255, 0.14);
            }
            .ccs-btn.primary {
                border-color: rgba(217, 130, 43, 0.42);
                background: rgba(217, 130, 43, 0.24);
                color: #ffd6a8;
            }
            .ccs-btn.danger {
                border-color: rgba(224, 80, 74, 0.32);
                background: rgba(224, 80, 74, 0.16);
                color: #ffb4ae;
            }
            .ccs-tools {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 8px;
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid var(--ccs-border);
            }
            #claude-cookie-switcher-min {
                position: fixed;
                z-index: 2147483646;
                width: 52px;
                height: 52px;
                border-radius: 50%;
                border: 1px solid rgba(217, 130, 43, 0.46);
                background: var(--ccs-bg);
                box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
                display: none;
                align-items: center;
                justify-content: center;
                color: #ffd6a8;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
                user-select: none;
            }
            .claude-switcher-modal {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: none;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.55);
                color: #f6f4ef;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .claude-switcher-modal.show {
                display: flex;
            }
            .ccs-modal-box {
                width: min(520px, calc(100vw - 28px));
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: #181b1f;
                box-shadow: 0 20px 64px rgba(0, 0, 0, 0.44);
                padding: 18px;
                box-sizing: border-box;
            }
            .ccs-modal-box h3 {
                margin: 0 0 8px 0;
                font-size: 16px;
            }
            .ccs-modal-box p {
                margin: 0 0 12px 0;
                color: rgba(246, 244, 239, 0.68);
                font-size: 12px;
                line-height: 1.5;
            }
            .ccs-textarea {
                width: 100%;
                height: 240px;
                box-sizing: border-box;
                padding: 10px;
                border-radius: 6px;
                border: 1px solid rgba(255, 255, 255, 0.16);
                background: #0f1114;
                color: #f6f4ef;
                resize: vertical;
                font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
                font-size: 12px;
                line-height: 1.45;
            }
            .ccs-modal-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
            }
            .ccs-modal-actions .ccs-btn {
                flex: 1;
            }
            .claude-switcher-toast {
                position: fixed;
                left: 50%;
                bottom: 28px;
                z-index: 2147483647;
                max-width: min(620px, calc(100vw - 28px));
                transform: translate(-50%, 16px);
                opacity: 0;
                pointer-events: none;
                padding: 10px 14px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(18, 20, 24, 0.94);
                color: #f6f4ef;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 13px;
                line-height: 1.45;
                transition: 0.2s ease;
                box-shadow: 0 12px 34px rgba(0, 0, 0, 0.35);
            }
            .claude-switcher-toast.show {
                opacity: 1;
                transform: translate(-50%, 0);
            }
            .claude-switcher-toast[data-type="success"] {
                border-left: 4px solid #6fbf73;
            }
            .claude-switcher-toast[data-type="error"] {
                border-left: 4px solid #e0504a;
            }
            .claude-switcher-toast[data-type="info"] {
                border-left: 4px solid #d9822b;
            }
        `;
        documentObj.head.appendChild(style);

        const panel = documentObj.createElement("div");
        panel.id = "claude-cookie-switcher-panel";
        panel.innerHTML = `
            <div class="ccs-header">
                <div class="ccs-title-wrap">
                    <span id="claude-switcher-title">Claude 账号助手</span>
                    <span class="ccs-subtitle">仅本地保存 Cookie 快照</span>
                </div>
                <button class="ccs-min-btn" id="claude-minimize" title="最小化">-</button>
            </div>
            <div class="ccs-body">
                <div class="ccs-status">
                    <div class="ccs-current">
                        <strong id="claude-current-label">未选择</strong>
                        <span>本地账号快照</span>
                    </div>
                    <div class="ccs-count" title="账号总数"><span id="claude-profile-total">0</span></div>
                </div>
                <select class="ccs-select" id="claude-profile-select" title="选择要切换的账号"></select>
                <div class="ccs-grid">
                    <button class="ccs-btn primary" id="claude-capture-current">保存当前</button>
                    <button class="ccs-btn primary" id="claude-switch-selected">切换选中</button>
                    <button class="ccs-btn" id="claude-prev-profile">上一个</button>
                    <button class="ccs-btn" id="claude-next-profile">下一个</button>
                    <button class="ccs-btn" id="claude-goto-profile">指定序号</button>
                    <button class="ccs-btn danger" id="claude-delete-profile">删除账号</button>
                </div>
                <div class="ccs-tools">
                    <button class="ccs-btn" id="claude-import-profiles">导入</button>
                    <button class="ccs-btn" id="claude-export-profiles">导出</button>
                    <button class="ccs-btn" id="claude-copy-current">复制当前</button>
                </div>
            </div>
        `;
        documentObj.body.appendChild(panel);

        const minIcon = documentObj.createElement("div");
        minIcon.id = "claude-cookie-switcher-min";
        minIcon.textContent = "Claude";
        minIcon.title = "展开 Claude 账号助手";
        documentObj.body.appendChild(minIcon);

        const importModal = documentObj.createElement("div");
        importModal.className = "claude-switcher-modal";
        importModal.id = "claude-import-modal";
        importModal.innerHTML = `
            <div class="ccs-modal-box">
                <h3>导入 Claude Cookie 备份</h3>
                <p>请只导入你自己保存的 JSON。Cookie 备份等同登录凭证，不要分享给不可信的人。</p>
                <textarea class="ccs-textarea" id="claude-import-area" placeholder="在这里粘贴导出的 JSON"></textarea>
                <div class="ccs-modal-actions">
                    <button class="ccs-btn primary" id="claude-import-run">导入</button>
                    <button class="ccs-btn" id="claude-import-cancel">取消</button>
                </div>
            </div>
        `;
        documentObj.body.appendChild(importModal);

        const toastEl = documentObj.createElement("div");
        toastEl.className = "claude-switcher-toast";
        documentObj.body.appendChild(toastEl);

        wireUI(panel, minIcon);
        applyPanelPosition(panel, minIcon);
        updateUI();
    }

    function wireUI(panel, minIcon) {
        const select = byId("claude-profile-select");
        if (select) {
            select.onchange = () => {
                state.selectedProfileId = select.value;
                updateUI();
            };
        }

        byId("claude-capture-current").onclick = () => captureCurrentProfile();
        byId("claude-switch-selected").onclick = () => switchToProfile(getSelectedProfile());
        byId("claude-prev-profile").onclick = () => switchToProfile(resolveRelativeIndex(-1));
        byId("claude-next-profile").onclick = () => switchToProfile(resolveRelativeIndex(1));
        byId("claude-goto-profile").onclick = () => {
            if (!state.profiles.length) {
                toast("还没有保存账号。", "error");
                return;
            }
            const input = promptFn(`请输入序号 1-${state.profiles.length}:`, "1");
            if (input === null) return;
            const index = Number.parseInt(input, 10) - 1;
            if (Number.isNaN(index)) {
                toast("序号无效。", "error");
                return;
            }
            switchToProfile(index);
        };
        byId("claude-delete-profile").onclick = () => removeSelectedProfile();
        byId("claude-import-profiles").onclick = () => openModal("claude-import-modal");
        byId("claude-export-profiles").onclick = () => {
            if (!state.profiles.length) {
                toast("还没有可导出的账号。", "error");
                return;
            }
            copyExport(state.profiles, "已复制全部账号 JSON 备份。");
        };
        byId("claude-copy-current").onclick = () => {
            const profile = getSelectedProfile();
            if (!profile) {
                toast("没有可复制的账号。", "error");
                return;
            }
            copyExport([profile], "已复制选中账号 JSON。");
        };
        byId("claude-import-run").onclick = () => importFromModal();
        byId("claude-import-cancel").onclick = () => closeModal("claude-import-modal");
        byId("claude-minimize").onclick = () => togglePanel(panel, minIcon, true);
        minIcon.onclick = () => {
            if (!minIcon.hasAttribute("data-dragging")) {
                togglePanel(panel, minIcon, false);
            }
        };

        enableDrag(panel, panel.querySelector(".ccs-header"), (pos) => {
            savePanelState({ ...state.panel, ...pos });
            minIcon.style.top = pos.top;
            minIcon.style.left = pos.left;
            minIcon.style.right = "";
        });
        enableDrag(minIcon, minIcon, (pos) => {
            savePanelState({ ...state.panel, ...pos });
            panel.style.top = pos.top;
            panel.style.left = pos.left;
            panel.style.right = "";
        });

        gm.registerMenuCommand("Claude 切换器：保存当前账号", () => captureCurrentProfile());
        gm.registerMenuCommand("Claude 切换器：导出全部 JSON", () => copyExport(state.profiles, "已复制全部账号 JSON 备份。"));
        gm.registerMenuCommand("Claude 切换器：重置面板位置", () => {
            savePanelState({ top: "84px", right: "36px", minimized: false });
            applyPanelPosition(panel, minIcon);
            toast("面板位置已重置。", "success");
        });
    }

    function applyPanelPosition(panel, minIcon) {
        const top = state.panel.top || "84px";
        const left = state.panel.left || "";
        const right = state.panel.right || "36px";

        [panel, minIcon].forEach((el) => {
            el.style.top = top;
            el.style.left = left || "auto";
            el.style.right = left ? "auto" : right;
        });

        if (state.panel.minimized) {
            panel.style.display = "none";
            minIcon.style.display = "flex";
        } else {
            panel.style.display = "block";
            minIcon.style.display = "none";
        }
    }

    function togglePanel(panel, minIcon, minimized) {
        const visibleElement = minimized ? panel : minIcon;
        const rect = visibleElement.getBoundingClientRect();
        const pos = {
            top: `${Math.max(0, rect.top)}px`,
            left: `${Math.max(0, rect.left)}px`,
            right: "",
            minimized
        };
        savePanelState(pos);

        panel.style.top = pos.top;
        panel.style.left = pos.left;
        panel.style.right = "auto";
        minIcon.style.top = pos.top;
        minIcon.style.left = pos.left;
        minIcon.style.right = "auto";
        panel.style.display = minimized ? "none" : "block";
        minIcon.style.display = minimized ? "flex" : "none";
    }

    function enableDrag(element, handle, onDone) {
        if (!element || !handle || !documentObj) return;

        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        handle.addEventListener("mousedown", (event) => {
            dragging = true;
            moved = false;
            element.removeAttribute("data-dragging");

            const rect = element.getBoundingClientRect();
            startX = event.clientX;
            startY = event.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.top}px`;
            element.style.right = "auto";

            documentObj.addEventListener("mousemove", onMove);
            documentObj.addEventListener("mouseup", onUp);
        });

        function onMove(event) {
            if (!dragging) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                moved = true;
                element.setAttribute("data-dragging", "true");
            }
            if (!moved) return;
            const nextLeft = Math.max(0, startLeft + dx);
            const nextTop = Math.max(0, startTop + dy);
            element.style.left = `${nextLeft}px`;
            element.style.top = `${nextTop}px`;
        }

        function onUp() {
            dragging = false;
            documentObj.removeEventListener("mousemove", onMove);
            documentObj.removeEventListener("mouseup", onUp);
            if (moved) {
                const pos = {
                    top: element.style.top,
                    left: element.style.left,
                    right: ""
                };
                onDone(pos);
                setTimeoutFn(() => element.removeAttribute("data-dragging"), 80);
            }
        }
    }

    function init() {
        if (!documentObj) return;
        if (!documentObj.body || !documentObj.head) {
            setTimeoutFn(init, 50);
            return;
        }
        createUI();
    }

    function run() {
        loadState();
        if (runtime.autoInit === false) return;
        init();
    }

    loadState();

    return {
        constants,
        state,
        run,
        captureCurrentProfile,
        switchToProfile,
        importProfilesFromJson,
        exportData,
        copyExport,
        removeSelectedProfile,
        _internal: {
            normalizeCookie,
            normalizeCookieList,
            isClaudeCookie,
            cookieKey,
            cookieUrl,
            buildSetDetails,
            buildDeleteDetails,
            listClaudeCookies,
            deleteCurrentClaudeCookies,
            setProfileCookies,
            verifyProfileCookies,
            clearClaudeClientState,
            hasAuthCookie,
            normalizeIndex,
            resolveRelativeIndex,
            formatError
        }
    };
});
