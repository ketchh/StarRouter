/*
 * Offline-suite preload. This denies the standard in-process Node network entry points used by
 * StarRouter and its dependencies. It is a deterministic test guard, not an operating-system
 * sandbox: a malicious test could still escape through child_process or native code.
 */
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const MESSAGE = "Network access is disabled during StarRouter offline tests";
const deny = () => {
	throw new Error(MESSAGE);
};
const denyFetch = async (input) => {
	throw new Error(`${MESSAGE} (${String(input)})`);
};

process.env.STAR_ROUTER_OFFLINE_TESTS = "1";
globalThis.fetch = denyFetch;
for (const name of ["WebSocket", "EventSource"]) {
	if (!(name in globalThis)) continue;
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value: class OfflineNetworkClient { constructor() { deny(); } },
	});
}

http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
http2.connect = deny;
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
tls.connect = deny;
dgram.createSocket = deny;
const dnsMethods = [
	"lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa",
	"resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv",
	"resolveTxt", "reverse",
];
for (const key of dnsMethods) {
	if (key in dns) dns[key] = deny;
	if (dns.promises && key in dns.promises) dns.promises[key] = deny;
	if (key in dns.Resolver.prototype) dns.Resolver.prototype[key] = deny;
}

// Keep named ESM imports (for example `import { request } from "node:https"`) in sync.
syncBuiltinESMExports();
