import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerCommands: vi.fn(),
	handleSessionStart: vi.fn(),
	handleNewSessionSwitch: vi.fn(),
	buildMulticodexProviderConfig: vi.fn<() => { mocked: boolean } | undefined>(
		() => ({ mocked: true }),
	),
	setWarningHandler: vi.fn(),
	loadPiAuth: vi.fn().mockResolvedValue(undefined),
	onStateChange: vi.fn<(handler: () => void) => () => void>(
		() => () => undefined,
	),
	resetSessionWarnings: vi.fn(),
	statusRefreshFor: vi.fn(),
	statusStartAutoRefresh: vi.fn(),
	statusStopAutoRefresh: vi.fn(),
	statusLoadPreferences: vi.fn().mockResolvedValue(undefined),
	statusScheduleModelSelectRefresh: vi.fn(),
}));

vi.mock("./account-manager", () => ({
	AccountManager: class MockAccountManager {
		setWarningHandler = mocks.setWarningHandler;
		loadPiAuth = mocks.loadPiAuth;
		onStateChange = mocks.onStateChange;
		resetSessionWarnings = mocks.resetSessionWarnings;
	},
}));

vi.mock("./commands", () => ({
	registerCommands: mocks.registerCommands,
}));

vi.mock("./hooks", () => ({
	handleNewSessionSwitch: mocks.handleNewSessionSwitch,
	handleSessionStart: mocks.handleSessionStart,
}));

vi.mock("./provider", () => ({
	PROVIDER_ID: "openai-codex",
	buildMulticodexProviderConfig: mocks.buildMulticodexProviderConfig,
}));

vi.mock("./status", () => ({
	createUsageStatusController: () => ({
		loadPreferences: mocks.statusLoadPreferences,
		refreshFor: mocks.statusRefreshFor,
		scheduleModelSelectRefresh: mocks.statusScheduleModelSelectRefresh,
		startAutoRefresh: mocks.statusStartAutoRefresh,
		stopAutoRefresh: mocks.statusStopAutoRefresh,
	}),
}));

import multicodexExtension from "./extension";

describe("multicodexExtension", () => {
	beforeEach(() => {
		mocks.registerCommands.mockClear();
		mocks.handleSessionStart.mockClear();
		mocks.handleNewSessionSwitch.mockClear();
		mocks.buildMulticodexProviderConfig.mockClear();
		mocks.setWarningHandler.mockClear();
		mocks.loadPiAuth.mockClear();
		mocks.onStateChange.mockClear();
		mocks.resetSessionWarnings.mockClear();
		mocks.statusRefreshFor.mockClear();
		mocks.statusStartAutoRefresh.mockClear();
		mocks.statusStopAutoRefresh.mockClear();
		mocks.statusLoadPreferences.mockClear();
		mocks.statusScheduleModelSelectRefresh.mockClear();
	});

	it("registers provider, commands, and lifecycle hooks", async () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const registerProvider = vi.fn();
		const unregisterProvider = vi.fn();
		const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			handlers.set(event, handler);
		});

		await multicodexExtension({
			registerProvider,
			unregisterProvider,
			on,
		} as never);

		expect(mocks.setWarningHandler).toHaveBeenCalledOnce();
		expect(mocks.loadPiAuth).toHaveBeenCalledOnce();
		expect(mocks.buildMulticodexProviderConfig).toHaveBeenCalledOnce();
		expect(mocks.onStateChange).toHaveBeenCalledOnce();
		expect(registerProvider).toHaveBeenCalledWith("openai-codex", {
			mocked: true,
		});
		expect(unregisterProvider).not.toHaveBeenCalled();
		expect(mocks.registerCommands).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledTimes(4);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("turn_end")).toBe(true);
		expect(handlers.has("model_select")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});

	it("unregisters the provider when no usable account is available", async () => {
		mocks.buildMulticodexProviderConfig.mockReturnValueOnce(undefined);
		const registerProvider = vi.fn();
		const unregisterProvider = vi.fn();

		await multicodexExtension({
			registerProvider,
			unregisterProvider,
			on: vi.fn(),
		} as never);

		expect(unregisterProvider).toHaveBeenCalledWith("openai-codex");
		expect(registerProvider).not.toHaveBeenCalled();
		expect(mocks.registerCommands).toHaveBeenCalledOnce();
	});

	it("resyncs provider registration when account state changes", async () => {
		const registerProvider = vi.fn();
		const unregisterProvider = vi.fn();
		let stateHandler: (() => void) | undefined;
		mocks.onStateChange.mockImplementationOnce((handler: () => void) => {
			stateHandler = handler;
			return () => undefined;
		});
		mocks.buildMulticodexProviderConfig
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce({ mocked: true });

		await multicodexExtension({
			registerProvider,
			unregisterProvider,
			on: vi.fn(),
		} as never);

		expect(unregisterProvider).toHaveBeenCalledWith("openai-codex");
		stateHandler?.();
		expect(registerProvider).toHaveBeenCalledWith("openai-codex", {
			mocked: true,
		});
	});

	it("routes session and status events to the helpers", async () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const ctx = { ui: { notify: vi.fn() } };

		await multicodexExtension({
			registerProvider: vi.fn(),
			unregisterProvider: vi.fn(),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.set(event, handler);
			}),
		} as never);

		const sessionStart = handlers.get("session_start");
		const turnEnd = handlers.get("turn_end");
		const modelSelect = handlers.get("model_select");
		const sessionShutdown = handlers.get("session_shutdown");
		expect(sessionStart).toBeTypeOf("function");
		expect(turnEnd).toBeTypeOf("function");
		expect(modelSelect).toBeTypeOf("function");
		expect(sessionShutdown).toBeTypeOf("function");

		sessionStart?.({ reason: "resume" }, ctx as never);
		expect(mocks.resetSessionWarnings).toHaveBeenCalledTimes(1);
		expect(mocks.handleSessionStart).toHaveBeenCalledOnce();
		expect(mocks.handleNewSessionSwitch).not.toHaveBeenCalled();
		expect(mocks.statusStartAutoRefresh).toHaveBeenCalledOnce();
		await vi.waitFor(() => {
			expect(mocks.statusLoadPreferences).toHaveBeenCalledTimes(1);
			expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(1);
		});

		sessionStart?.({ reason: "new" }, ctx as never);
		expect(mocks.resetSessionWarnings).toHaveBeenCalledTimes(2);
		expect(mocks.handleNewSessionSwitch).toHaveBeenCalledOnce();
		expect(mocks.statusStartAutoRefresh).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => {
			expect(mocks.statusLoadPreferences).toHaveBeenCalledTimes(2);
			expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(2);
		});

		turnEnd?.({}, ctx as never);
		modelSelect?.({}, ctx as never);
		expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(3);
		expect(mocks.statusScheduleModelSelectRefresh).toHaveBeenCalledWith(ctx);

		sessionShutdown?.({}, ctx as never);
		expect(mocks.statusStopAutoRefresh).toHaveBeenCalledWith(ctx);
	});
});
