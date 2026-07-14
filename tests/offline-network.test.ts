import test from "node:test";
import assert from "node:assert/strict";
import { get as httpsGet } from "node:https";
import { connect as netConnect, Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createSocket } from "node:dgram";
import { lookup, resolveMx, Resolver } from "node:dns";

/*
 * Verifies npm test loaded the offline guard and denies Fetch plus direct HTTPS/TCP/TLS/UDP/DNS
 * entry points before any production test can accidentally depend on the network.
 */
test("offline suite blocks standard in-process network entry points", async () => {
	assert.equal(process.env.STAR_ROUTER_OFFLINE_TESTS, "1");
	await assert.rejects(fetch("https://example.com"), /Network access is disabled/);
	for (const attempt of [
		() => httpsGet("https://example.com"),
		() => netConnect(443, "example.com"),
		() => new Socket().connect(443, "example.com"),
		() => tlsConnect(443, "example.com"),
		() => createSocket("udp4"),
		() => lookup("example.com", () => {}),
		() => resolveMx("example.com", () => {}),
		() => new Resolver().resolve4("example.com", () => {}),
	]) {
		assert.throws(attempt, /Network access is disabled/);
	}
});
