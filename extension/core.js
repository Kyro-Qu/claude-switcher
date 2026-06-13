(function(root, factory) {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory();
    } else {
        root.ClaudeSwitcherCore = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    const constants = {
        VERSION: "1.1.0",
        HOME_URL: "https://claude.ai/",
        TARGET_HOST: "claude.ai",
        PROFILE_KEY: "claude_cookie_profiles_v1",
        CURRENT_PROFILE_KEY: "claude_current_profile_id",
        EXPORT_VERSION: 1,
        AUTH_COOKIE_NAMES: ["sessionKey", "sessionKeyV2"],
        EXCLUDED_COOKIE_NAMES: ["cf_clearance", "__cf_bm", "_cfuvid", "__cflb", "__cfseq"]
    };

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
            sameSite: typeof cookie.sameSite === "string" ? cookie.sameSite : "unspecified",
            session: Boolean(cookie.session),
            hostOnly: Boolean(cookie.hostOnly)
        };

        if (typeof cookie.expirationDate === "number" && Number.isFinite(cookie.expirationDate)) {
            normalized.expirationDate = cookie.expirationDate;
        }
        if (typeof cookie.storeId === "string" && cookie.storeId) {
            normalized.storeId = cookie.storeId;
        }
        if (cookie.partitionKey && typeof cookie.partitionKey === "object") {
            normalized.partitionKey = cloneJson(cookie.partitionKey);
        }

        return normalized;
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
            cookie.storeId || "",
            JSON.stringify(cookie.partitionKey || {})
        ].join("|");
    }

    function normalizeCookieList(cookies) {
        const map = new Map();
        (Array.isArray(cookies) ? cookies : [])
            .map(normalizeCookie)
            .filter(Boolean)
            .forEach((cookie) => {
                if (shouldManageCookie(cookie)) {
                    map.set(cookieKey(cookie), cookie);
                }
            });

        return Array.from(map.values()).sort((a, b) => {
            const left = `${a.storeId || ""}|${a.domain}|${a.path}|${a.name}`;
            const right = `${b.storeId || ""}|${b.domain}|${b.path}|${b.name}`;
            return left.localeCompare(right);
        });
    }

    function hasAuthCookie(cookies) {
        return (Array.isArray(cookies) ? cookies : []).some((cookie) => constants.AUTH_COOKIE_NAMES.includes(cookie.name));
    }

    function authCookieNames(cookies) {
        return Array.from(new Set(
            (Array.isArray(cookies) ? cookies : [])
                .filter((cookie) => constants.AUTH_COOKIE_NAMES.includes(cookie.name))
                .map((cookie) => cookie.name)
        )).sort();
    }

    function cookieNameSummary(cookies) {
        return Array.from(new Set((Array.isArray(cookies) ? cookies : []).map((cookie) => cookie.name))).sort();
    }

    function normalizeProfile(profile) {
        if (!profile || typeof profile !== "object") return null;
        const cookies = normalizeCookieList(Array.isArray(profile.cookies) ? profile.cookies : []);
        if (!cookies.length) return null;

        return {
            id: String(profile.id || createId()),
            label: String(profile.label || "Claude 账号").trim() || "Claude 账号",
            capturedAt: String(profile.capturedAt || new Date().toISOString()),
            cookies
        };
    }

    function normalizeProfiles(profiles) {
        return (Array.isArray(profiles) ? profiles : []).map(normalizeProfile).filter(Boolean);
    }

    function createProfile(label, cookies, id) {
        const normalizedCookies = normalizeCookieList(cookies);
        if (!normalizedCookies.length) {
            throw new Error("未读取到可保存的 claude.ai Cookie。");
        }
        if (!hasAuthCookie(normalizedCookies)) {
            throw new Error("未读取到 sessionKey/sessionKeyV2，无法保存可切换账号。请确认扩展拥有 cookies 权限并重新登录 Claude。");
        }

        return {
            id: id || createId(),
            label: String(label || "").trim() || "Claude 账号",
            capturedAt: new Date().toISOString(),
            cookies: normalizedCookies
        };
    }

    function exportData(profiles) {
        return {
            version: constants.EXPORT_VERSION,
            target: constants.HOME_URL,
            exportedAt: new Date().toISOString(),
            profiles: normalizeProfiles(profiles).map((profile) => cloneJson(profile))
        };
    }

    function importProfilesFromJson(rawText) {
        const parsed = JSON.parse(String(rawText || ""));
        const incoming = Array.isArray(parsed) ? parsed : parsed.profiles;
        if (!Array.isArray(incoming)) {
            throw new Error("JSON 中未找到 profiles 数组。");
        }
        return normalizeProfiles(incoming);
    }

    function profileMeta(profile) {
        return {
            id: profile.id,
            label: profile.label,
            capturedAt: profile.capturedAt,
            cookieCount: profile.cookies.length,
            authCookieNames: authCookieNames(profile.cookies)
        };
    }

    function profilesMeta(profiles) {
        return normalizeProfiles(profiles).map(profileMeta);
    }

    function diagnoseCookies(cookies) {
        const normalized = normalizeCookieList(cookies);
        const authNames = authCookieNames(normalized);
        return {
            version: constants.VERSION,
            target: constants.HOME_URL,
            createdAt: new Date().toISOString(),
            cookieCount: normalized.length,
            httpOnlyCount: normalized.filter((cookie) => cookie.httpOnly).length,
            authCookieNames: authNames,
            cookieNames: cookieNameSummary(normalized),
            hasSessionKeyLC: normalized.some((cookie) => cookie.name === "sessionKeyLC"),
            canSwitch: authNames.length > 0,
            hint: authNames.length > 0
                ? "已读取到 Claude 认证 Cookie，可以保存并切换。"
                : "未读取到 sessionKey/sessionKeyV2。当前环境无法保存可切换账号。"
        };
    }

    function cookieUrl(cookie) {
        const domain = String(cookie?.domain || constants.TARGET_HOST).replace(/^\./, "") || constants.TARGET_HOST;
        const path = String(cookie?.path || "/");
        return `https://${domain}${path.startsWith("/") ? path : `/${path}`}`;
    }

    function buildSetDetails(cookie) {
        const details = {
            url: cookieUrl(cookie),
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || "/",
            secure: Boolean(cookie.secure),
            httpOnly: Boolean(cookie.httpOnly),
            sameSite: cookie.sameSite || "unspecified"
        };

        if (!cookie.hostOnly && cookie.domain) {
            details.domain = cookie.domain;
        }
        if (!cookie.session && typeof cookie.expirationDate === "number") {
            details.expirationDate = cookie.expirationDate;
        }
        if (cookie.storeId) {
            details.storeId = cookie.storeId;
        }
        if (cookie.partitionKey) {
            details.partitionKey = cloneJson(cookie.partitionKey);
        }

        return details;
    }

    function buildRemoveDetails(cookie) {
        const details = {
            url: cookieUrl(cookie),
            name: cookie.name
        };
        if (cookie.storeId) {
            details.storeId = cookie.storeId;
        }
        if (cookie.partitionKey) {
            details.partitionKey = cloneJson(cookie.partitionKey);
        }
        return details;
    }

    return {
        constants,
        cloneJson,
        normalizeCookie,
        normalizeCookieList,
        normalizeProfile,
        normalizeProfiles,
        createProfile,
        exportData,
        importProfilesFromJson,
        profileMeta,
        profilesMeta,
        diagnoseCookies,
        hasAuthCookie,
        authCookieNames,
        cookieNameSummary,
        isClaudeCookie,
        isExcludedCookie,
        shouldManageCookie,
        cookieKey,
        cookieUrl,
        buildSetDetails,
        buildRemoveDetails
    };
});
