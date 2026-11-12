### Feature: API wrapper cleanup preserves active flows

#### Prerequisites
- Start the app with an independently managed authenticated App Server and a project containing a text file.
- Have enough thread history to load earlier messages.

#### Steps
1. Open a thread, load earlier messages, and switch to another thread.
2. Submit a message and observe streamed notifications and completion.
3. Open a project file through the read-only browser and download it. Confirm no editing action is offered.
4. Open Skills & Apps and verify supported capabilities remain available.
5. Request a review through the runtime's supported chat/RPC flow and verify the response arrives.

#### Expected Results
- Thread loading, notifications, generic review RPC, and read-only file browsing work. Bundled metadata is advisory, not capability negotiation.
- Compatibility HTTP endpoints listed in [the bridge contracts](../../PROJECT_SPEC.md#bridge-contracts) remain registered.

#### Rollback/Cleanup
- Remove test messages and resolve any outstanding runtime request.

### Feature: Legacy direct-file endpoint retirement

#### Prerequisites
- Run production and development servers separately with a temporary project containing a text file, a subdirectory, and an image.

#### Steps
1. Select the project using the folder picker and navigate into its subdirectory.
2. Open a conversation file link; browse the directory, open the text file, verify its contents and download it. Confirm no Edit file action is present.
3. Render a local image in conversation markdown and attach both an image and a text file; send the message and reopen the thread.
4. Request `/codex-local-file?path=<absolute-text-file-path>` with GET and HEAD against each server.

#### Expected Results
- Folder selection, conversation navigation, read-only browsing, image rendering, and attachment previews/content work through their existing supported endpoints.
- The retired URL never serves the requested local file (the ordinary SPA fallback may respond).

#### Rollback/Cleanup
- Remove temporary files and test messages.
