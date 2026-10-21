Release builds embed runtime.zip here. It contains a platform-specific Node
runtime, the locked production dependencies, and the DevTools host sources.
Run npm run build:cli to produce a self-contained development binary.
The runtime is never downloaded or installed on an end user's machine.
