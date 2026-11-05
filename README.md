# Kontent.ai Asset Manager (extended)

## Features
- Loads all assets from the Kontent.ai Management API v2, following `pagination.continuation_token` with the `x-continuation` header.
- Searches loaded results by file name, asset ID, folder ID, collection, and URL.
- Selects individual assets, all visible assets, or clears the selection.
- Permanently deletes selected assets sequentially and reports per-asset failures.
- Exports the filtered results to CSV.
- Keeps the original project dependency-free (apart from the SheetJS CDN script retained for compatibility; CSV export uses native browser APIs).

## Run
1. Extract the ZIP.
2. Open `index.html` in a modern browser.
3. Enter the Kontent.ai Environment ID and a Management API key with the required permissions.
4. Select **Load assets**.

The browser must be able to reach `https://manage.kontent.ai`. If your browser blocks the cross-origin request, serve the files from a local web server or deploy them to an HTTPS origin allowed by your environment/browser configuration.

## Important API limitation: Publish and Archive
This repository lists **assets**, not content items. The Kontent.ai Management API v2 has a `DELETE /projects/{environment_id}/assets/{asset_identifier}` operation for deleting an unused asset. Assets do not have content-item workflow steps and do not expose asset-level Publish or Archive operations.

Therefore:
- **Delete selected** is implemented.
- **Publish selected** and **Archive selected** are shown disabled, with an explanation, rather than sending invalid API requests.

If the actual requirement is to bulk publish/archive **content items that reference these assets**, that requires a separate content-item workflow implementation. It needs item IDs and language variant identifiers and should be designed as a separate operation from asset management.

## Deletion behavior
- Deletion is permanent and requires browser confirmation.
- Kontent.ai only allows deleting assets that are unused. Assets referenced by content items can fail; the error message is retained in the results summary.
- Requests are sent sequentially to avoid firing a large burst of destructive API calls.
- The tool does not retain the entered API key after the page is closed; it is held in the page's memory while open. Use a key with least privilege and avoid running the page on an untrusted computer.

## Files
- `index.html` — responsive UI.
- `index.js` — API pagination, local search, selection, CSV export, and bulk deletion.


## Draft content-item management (added)
- Switch to **Draft Content Items** and select **Search draft items**.
- Uses Management API v2 `POST /items-with-variant/filter` to find language variants in the `draft` workflow step, then `POST /items-with-variant/bulk-get` to retrieve their details.
- Search results are shown per language variant with item name, codename, language, content type, collection, last modified date, and workflow step.
- Supports individual selection, select visible, clear selection, CSV export, bulk delete, and bulk archive.
- **Delete** uses `DELETE /items/{item_id}/variants/{language_id}`. This deletes only the selected language variant; if it is the final variant, Kontent.ai deletes the whole content item.
- **Archive** uses `PUT /items/{item_id}/variants/{language_id}/change-workflow`, preserving the current workflow and requesting its `archived` step. The workflow transition must be allowed for the API key's role.

The draft filter currently targets the workflow-step codename `draft`. If your environment uses a differently named first workflow step, adjust the filter and the defensive step-codename check in `index.js` accordingly. This is a browser-only tool; test first in a non-production environment and use a least-privilege Management API key. Bulk operations are sequential and report per-variant failures.
