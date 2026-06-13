const assert = require("node:assert/strict");
const createClaudeCookieSwitcher = require("./Claude Cookie 切换器.user.js");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function cookieKey(cookie) {
    return [
        cookie.name,
        cookie.domain,
        cookie.path || "/",
        JSON.stringify(cookie.partitionKey || {})
    ].join("|");
}

function makeRuntime(initialCookies = [], existingStorage = null) {
    const storage = existingStorage || new Map();
    const clipboard = { value: "" };
    const redirects = [];
    const calls = [];
    const jar = {
        cookies: clone(initialCookies),
        list(details, callback) {
            calls.push({ method: "list", details: clone(details) });
            callback(clone(this.cookies));
        },
        set(details, callback) {
            calls.push({ method: "set", details: clone(details) });
            const url = new URL(details.url || "https://claude.ai/");
            const cookie = {
                name: details.name,
                value: details.value,
                domain: details.domain || url.hostname,
                path: details.path || "/",
                secure: Boolean(details.secure),
                httpOnly: Boolean(details.httpOnly),
                sameSite: details.sameSite,
                session: typeof details.expirationDate !== "number",
                hostOnly: !details.domain
            };
            if (typeof details.expirationDate === "number") {
                cookie.expirationDate = details.expirationDate;
            }
            if (details.partitionKey) {
                cookie.partitionKey = clone(details.partitionKey);
            }
            this.cookies = this.cookies.filter((item) => cookieKey(item) !== cookieKey(cookie));
            this.cookies.push(cookie);
            callback();
        },
        delete(details, callback) {
            calls.push({ method: "delete", details: clone(details) });
            const url = new URL(details.url || "https://claude.ai/");
            this.cookies = this.cookies.filter((cookie) => {
                const domain = String(cookie.domain || "").replace(/^\./, "");
                const isTargetDomain = domain === url.hostname;
                const isTargetName = cookie.name === details.name;
                const isTargetPartition = JSON.stringify(cookie.partitionKey || {}) === JSON.stringify(details.partitionKey || {});
                return !(isTargetDomain && isTargetName && isTargetPartition);
            });
            callback();
        }
    };

    return {
        storage,
        clipboard,
        redirects,
        calls,
        jar,
        runtime: {
            autoInit: false,
            now: () => Date.UTC(2026, 5, 13, 8, 0, 0),
            uuid: (() => {
                let index = 0;
                return () => `profile-${++index}`;
            })(),
            confirm: () => true,
            prompt: (_message, fallback) => fallback,
            setTimeout: (fn) => {
                fn();
                return 1;
            },
            clearTimeout: () => {},
            location: {
                replace(url) {
                    redirects.push(url);
                }
            },
            gm: {
                getValue(key, fallback) {
                    return storage.has(key) ? storage.get(key) : fallback;
                },
                setValue(key, value) {
                    storage.set(key, clone(value));
                },
                deleteValue(key) {
                    storage.delete(key);
                },
                setClipboard(value) {
                    clipboard.value = value;
                },
                registerMenuCommand() {},
                cookie: jar
            }
        }
    };
}

async function testCaptureFiltersClaudeCookies() {
    const env = makeRuntime([
        {
            name: "sessionKey",
            value: "A_SESSION",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false
        },
        {
            name: "theme",
            value: "dark",
            domain: "claude.ai",
            path: "/",
            secure: true,
            httpOnly: false,
            sameSite: "lax",
            session: true,
            hostOnly: true
        },
        {
            name: "ignored",
            value: "x",
            domain: ".example.com",
            path: "/",
            secure: true,
            httpOnly: true
        }
    ]);
    const app = createClaudeCookieSwitcher(env.runtime);

    const profile = await app.captureCurrentProfile("Alice");

    assert.equal(profile.label, "Alice");
    assert.equal(profile.cookies.length, 2);
    assert.equal(profile.cookies.some((cookie) => cookie.name === "ignored"), false);
    assert.equal(app.state.currentProfileId, "profile-1");
    assert.equal(env.storage.get(app.constants.PROFILE_KEY).length, 1);
}

async function testSwitchDeletesAndWritesProfileCookies() {
    const env = makeRuntime([
        {
            name: "sessionKey",
            value: "A_SESSION",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false
        },
        {
            name: "theme",
            value: "dark",
            domain: "claude.ai",
            path: "/",
            secure: true,
            httpOnly: false,
            sameSite: "lax",
            session: true,
            hostOnly: true
        }
    ]);
    const app = createClaudeCookieSwitcher(env.runtime);
    await app.captureCurrentProfile("Alice");

    env.jar.cookies = [
        {
            name: "sessionKey",
            value: "B_SESSION",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false
        }
    ];

    const switched = await app.switchToProfile(0);
    const storedSession = env.jar.cookies.find((cookie) => cookie.name === "sessionKey");
    const setTheme = env.calls.find((call) => call.method === "set" && call.details.name === "theme");

    assert.equal(switched, true);
    assert.equal(storedSession.value, "A_SESSION");
    assert.equal(setTheme.details.domain, undefined, "hostOnly cookies should be restored without a domain field");
    assert.equal(env.redirects.at(-1), "https://claude.ai/");
    assert.equal(env.calls.some((call) => call.method === "delete"), true);
}

async function testExportImportRoundTrip() {
    const env = makeRuntime([
        {
            name: "sessionKeyV2",
            value: "A_SESSION_V2",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false,
            partitionKey: {}
        }
    ]);
    const app = createClaudeCookieSwitcher(env.runtime);
    await app.captureCurrentProfile("Alice");
    const exported = app.copyExport();

    const secondEnv = makeRuntime([], new Map());
    const secondApp = createClaudeCookieSwitcher(secondEnv.runtime);
    const result = secondApp.importProfilesFromJson(exported);

    assert.equal(result.added, 1);
    assert.equal(result.replaced, 0);
    assert.equal(secondApp.state.profiles[0].label, "Alice");
    assert.equal(secondApp.state.profiles[0].cookies[0].name, "sessionKeyV2");
}

async function testImportReplacesSameId() {
    const env = makeRuntime([]);
    const app = createClaudeCookieSwitcher(env.runtime);
    const raw = JSON.stringify({
        version: 1,
        target: "https://claude.ai/",
        profiles: [
            {
                id: "same-id",
                label: "First",
                capturedAt: "2026-06-13T08:00:00.000Z",
                cookies: [
                    {
                        name: "sessionKey",
                        value: "one",
                        domain: ".claude.ai",
                        path: "/",
                        secure: true,
                        httpOnly: true,
                        sameSite: "lax",
                        expirationDate: 1800000000,
                        session: false,
                        hostOnly: false
                    }
                ]
            }
        ]
    });
    const replacement = raw.replace("\"First\"", "\"Second\"").replace("\"one\"", "\"two\"");

    app.importProfilesFromJson(raw);
    const result = app.importProfilesFromJson(replacement);

    assert.equal(result.added, 0);
    assert.equal(result.replaced, 1);
    assert.equal(app.state.profiles.length, 1);
    assert.equal(app.state.profiles[0].label, "Second");
    assert.equal(app.state.profiles[0].cookies[0].value, "two");
}

(async () => {
    await testCaptureFiltersClaudeCookies();
    await testSwitchDeletesAndWritesProfileCookies();
    await testExportImportRoundTrip();
    await testImportReplacesSameId();
    console.log("All Claude switcher tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
