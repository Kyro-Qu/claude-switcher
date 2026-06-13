const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./core.js");

function testManifestPermissions() {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, core.constants.VERSION);
    ["cookies", "storage", "tabs", "browsingData", "scripting"].forEach((permission) => {
        assert.equal(manifest.permissions.includes(permission), true, `${permission} permission is required`);
    });
    assert.equal(manifest.host_permissions.includes("https://claude.ai/*"), true);
    assert.equal(manifest.host_permissions.includes("https://*.claude.ai/*"), true);
}

function testNormalizeFiltersCloudflareAndKeepsAuth() {
    const cookies = core.normalizeCookieList([
        {
            name: "sessionKeyV2",
            value: "SECRET_AUTH",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false,
            storeId: "0"
        },
        {
            name: "__cf_bm",
            value: "SECRET_CF",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "no_restriction",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false
        },
        {
            name: "other",
            value: "x",
            domain: ".example.com",
            path: "/"
        }
    ]);

    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].name, "sessionKeyV2");
    assert.equal(cookies[0].httpOnly, true);
    assert.deepEqual(core.authCookieNames(cookies), ["sessionKeyV2"]);
}

function testCreateProfileRejectsWithoutRealAuthCookie() {
    assert.throws(() => core.createProfile("No Auth", [
        {
            name: "activitySessionId",
            value: "not-auth",
            domain: "claude.ai",
            path: "/",
            secure: true,
            httpOnly: false,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: true
        }
    ]), /sessionKey\/sessionKeyV2/);
}

function testBuildChromeCookieDetails() {
    const hostOnly = {
        name: "sessionKey",
        value: "SECRET",
        domain: "claude.ai",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        expirationDate: 1800000000,
        session: false,
        hostOnly: true,
        storeId: "0"
    };
    const domainCookie = { ...hostOnly, hostOnly: false, domain: ".claude.ai" };

    const hostOnlyDetails = core.buildSetDetails(hostOnly);
    const domainDetails = core.buildSetDetails(domainCookie);
    const removeDetails = core.buildRemoveDetails(domainCookie);

    assert.equal(hostOnlyDetails.domain, undefined);
    assert.equal(hostOnlyDetails.url, "https://claude.ai/");
    assert.equal(hostOnlyDetails.httpOnly, true);
    assert.equal(domainDetails.domain, ".claude.ai");
    assert.equal(removeDetails.name, "sessionKey");
    assert.equal(removeDetails.storeId, "0");
}

function testExportImportRoundTrip() {
    const profile = core.createProfile("Alice", [
        {
            name: "sessionKey",
            value: "SECRET_AUTH",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false
        }
    ], "profile-a");
    const exported = JSON.stringify(core.exportData([profile]));
    const imported = core.importProfilesFromJson(exported);

    assert.equal(imported.length, 1);
    assert.equal(imported[0].id, "profile-a");
    assert.equal(imported[0].cookies[0].name, "sessionKey");
}

function testDiagnoseDoesNotExposeValues() {
    const report = core.diagnoseCookies([
        {
            name: "sessionKey",
            value: "SECRET_AUTH_VALUE",
            domain: ".claude.ai",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 1800000000,
            session: false,
            hostOnly: false
        }
    ]);
    const text = JSON.stringify(report);

    assert.equal(report.canSwitch, true);
    assert.deepEqual(report.authCookieNames, ["sessionKey"]);
    assert.equal(text.includes("SECRET_AUTH_VALUE"), false);
}

testManifestPermissions();
testNormalizeFiltersCloudflareAndKeepsAuth();
testCreateProfileRejectsWithoutRealAuthCookie();
testBuildChromeCookieDetails();
testExportImportRoundTrip();
testDiagnoseDoesNotExposeValues();

console.log("All extension core tests passed.");
