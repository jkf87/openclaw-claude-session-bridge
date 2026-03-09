import type { BridgeResult, ExportedConfig, RemoteProbe, SendOptions, SessionMetadata, SessionRecord, SpawnOptions } from "./types";
export interface GatewayAdapter {
    sessionSpawn(opts?: SpawnOptions & {
        cwd?: string;
        agentId?: string;
    }): Promise<BridgeResult<{
        childSessionKey: string;
        rawText?: string;
    }>>;
    sessionSend(childSessionKey: string, message: string): Promise<BridgeResult<{
        reply: string;
    }>>;
    sessionStatus(childSessionKey: string): Promise<BridgeResult<Omit<RemoteProbe, "sessionKey">>>;
}
export declare class SimulatedGateway implements GatewayAdapter {
    sessionSpawn(_opts?: SpawnOptions & {
        cwd?: string;
        agentId?: string;
    }): Promise<BridgeResult<{
        childSessionKey: string;
    }>>;
    sessionSend(childSessionKey: string, message: string): Promise<BridgeResult<{
        reply: string;
    }>>;
    sessionStatus(_childSessionKey: string): Promise<BridgeResult<Omit<RemoteProbe, "sessionKey">>>;
}
export declare class RealGatewayCliAdapter implements GatewayAdapter {
    private readonly openclawBin;
    private readonly managerSessionKey;
    private readonly timeoutMs;
    private readonly defaultAgentId;
    private readonly defaultCwd;
    constructor(opts?: {
        openclawBin?: string;
        managerSessionKey?: string;
        timeoutMs?: number;
        agentId?: string;
        cwd?: string;
    });
    private gatewayCall;
    private chatHistory;
    private sendSlashCommand;
    private waitForNewAssistantText;
    sessionSpawn(opts?: SpawnOptions & {
        cwd?: string;
        agentId?: string;
    }): Promise<BridgeResult<{
        childSessionKey: string;
        rawText?: string;
    }>>;
    sessionSend(childSessionKey: string, message: string): Promise<BridgeResult<{
        reply: string;
    }>>;
    sessionStatus(childSessionKey: string): Promise<BridgeResult<Omit<RemoteProbe, "sessionKey">>>;
}
export declare class SessionBridge {
    private statePath?;
    private gateway;
    private defaultSpawnAgentId?;
    private defaultSpawnCwd?;
    constructor(opts?: {
        statePath?: string;
        gateway?: GatewayAdapter;
        defaultSpawnAgentId?: string;
        defaultSpawnCwd?: string;
    });
    private load;
    private save;
    private now;
    init(): BridgeResult;
    spawn(opts?: SpawnOptions & {
        cwd?: string;
        agentId?: string;
    }): Promise<BridgeResult<SessionRecord>>;
    send(message: string, opts?: SendOptions): Promise<BridgeResult<{
        reply: string;
        sessionKey: string;
    }>>;
    status(sessionKey?: string): BridgeResult;
    probe(sessionKey?: string): Promise<BridgeResult<RemoteProbe>>;
    bind(sessionKey: string, updates: Partial<Pick<SessionMetadata, "label" | "tags">>): BridgeResult<SessionRecord>;
    exportConfig(sessionKeys?: string[]): BridgeResult<ExportedConfig>;
    importConfig(config: ExportedConfig): BridgeResult<{
        imported: number;
    }>;
}
//# sourceMappingURL=bridge.d.ts.map