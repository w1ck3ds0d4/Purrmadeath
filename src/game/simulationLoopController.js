// Fixed-step simulation loop controller for foreground + background tab modes.
// Keeps browser ticker/visibility orchestration out of bootstrap core flow.
export function createSimulationLoopController(deps) {
    const {
        app,
        multiplayerClient,
        runGameStep,
        logDebug,
        onFpsSample,
        fixedStepMs = 1000 / 60,
        hiddenTickIntervalMs = 100,
        hiddenMaxStepMs = 125,
        maxSimulationStepsPerTick = 6
    } = deps;

    let hiddenTickTimerId = null;
    let hiddenLastTickMs = 0;
    let simulationAccumulatorMs = 0;

    function runSimulationFixedStep(elapsedMs, isBackgroundTick) {
        const clampedElapsedMs = Math.max(0, Math.min(hiddenMaxStepMs * maxSimulationStepsPerTick, elapsedMs));
        simulationAccumulatorMs += clampedElapsedMs;
        const multiplayerStats = multiplayerClient.getStats();
        const hiddenAuthorityCatchUp = Boolean(
            document.hidden &&
            multiplayerStats.connected &&
            multiplayerStats.isAuthority
        );
        const stepBudget = hiddenAuthorityCatchUp ? 90 : maxSimulationStepsPerTick;
        let steps = 0;
        while (simulationAccumulatorMs >= fixedStepMs && steps < stepBudget) {
            runGameStep(fixedStepMs, isBackgroundTick);
            simulationAccumulatorMs -= fixedStepMs;
            steps += 1;
        }
        if (steps >= stepBudget && simulationAccumulatorMs >= fixedStepMs) {
            simulationAccumulatorMs = hiddenAuthorityCatchUp
                ? Math.min(simulationAccumulatorMs, fixedStepMs * 4)
                : 0;
        }
    }

    function startHiddenTickLoop() {
        if (hiddenTickTimerId !== null) {
            return;
        }
        hiddenLastTickMs = performance.now();
        hiddenTickTimerId = window.setInterval(() => {
            const now = performance.now();
            const elapsedMs = now - hiddenLastTickMs;
            hiddenLastTickMs = now;
            runSimulationFixedStep(elapsedMs, true);
        }, hiddenTickIntervalMs);
        logDebug('Background simulation enabled');
    }

    function stopHiddenTickLoop() {
        if (hiddenTickTimerId === null) {
            return;
        }
        window.clearInterval(hiddenTickTimerId);
        hiddenTickTimerId = null;
        logDebug('Background simulation disabled');
    }

    function bind() {
        app.ticker.add((delta) => {
            if (document.hidden) {
                return;
            }
            const fps = delta.deltaMS > 0 ? 1000 / delta.deltaMS : 0;
            onFpsSample(fps);
            runSimulationFixedStep(delta.deltaMS, false);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                startHiddenTickLoop();
            } else {
                stopHiddenTickLoop();
                simulationAccumulatorMs = 0;
            }
        });
    }

    return {
        bind,
        runSimulationFixedStep
    };
}
