(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const envInput = $("envId");
  const tokenInput = $("bearerToken");
  const loadButton = $("loadButton");
  const searchInput = $("searchInput");
  const rowsElement = $("assetRows");
  const statusElement = $("status");
  const resultsElement = $("actionResults");
  const selectAll = $("selectAll");

  let assets = [];
  let selectedIds = new Set();
  let isLoading = false;
  let isDeleting = false;

  const setStatus = (message, type = "") => {
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
  };

  const setResults = (message, type = "") => {
    resultsElement.textContent = message;
    resultsElement.className = `status ${type}`;
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  const getConfig = () => {
    const environmentId = envInput.value.trim();
    const apiKey = tokenInput.value.trim();
    if (!environmentId || !apiKey) throw new Error("Enter both the Environment ID and Management API key.");
    return { environmentId, apiKey };
  };

  const apiRequest = async (url, apiKey, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body.message || body.detail || "";
      } catch (_) { /* Response may be empty. */ }
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ` (${response.statusText})`}`);
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : null;
  };

  const formatSize = (bytes) => {
    const size = Number(bytes);
    if (!Number.isFinite(size)) return "";
    if (size < 1024) return `${size} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = size / 1024, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(2)} ${units[unit]}`;
  };

  const filteredAssets = () => {
    const term = searchInput.value.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((asset) => [
      asset.file_name, asset.id, asset.folderId, asset.collection, asset.url
    ].some((value) => String(value ?? "").toLowerCase().includes(term)));
  };

  const updateCounters = () => {
    const visible = filteredAssets();
    $("loadedCount").textContent = assets.length;
    $("visibleCount").textContent = visible.length;
    $("selectedCount").textContent = selectedIds.size;
    $("selectVisibleButton").disabled = !assets.length || isLoading || isDeleting;
    $("clearSelectionButton").disabled = !selectedIds.size || isDeleting;
    $("deleteButton").disabled = !selectedIds.size || isDeleting;
    $("exportButton").disabled = !assets.length || isLoading;
    $("publishButton").disabled = true;
    $("archiveButton").disabled = true;
    selectAll.disabled = !visible.length || isDeleting;
    selectAll.checked = visible.length > 0 && visible.every((asset) => selectedIds.has(asset.id));
    selectAll.indeterminate = visible.some((asset) => selectedIds.has(asset.id)) && !selectAll.checked;
  };

  const renderRows = () => {
    const visible = filteredAssets();
    if (!visible.length) {
      rowsElement.innerHTML = `<tr><td colspan="8" class="empty">${assets.length ? "No assets match your search." : "No assets loaded."}</td></tr>`;
      updateCounters();
      return;
    }

    rowsElement.innerHTML = visible.map((asset) => {
      const checked = selectedIds.has(asset.id) ? "checked" : "";
      const url = asset.url ? `<a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : "";
      return `<tr class="${checked ? "selected" : ""}">
        <td><input class="check asset-check" type="checkbox" data-id="${escapeHtml(asset.id)}" ${checked} aria-label="Select ${escapeHtml(asset.file_name)}"></td>
        <td class="file">${escapeHtml(asset.file_name)}</td>
        <td class="id">${escapeHtml(asset.id)}</td>
        <td>${escapeHtml(formatSize(asset.size))}</td>
        <td class="id">${escapeHtml(asset.folderId)}</td>
        <td>${escapeHtml(asset.collection)}</td>
        <td>${escapeHtml(asset.last_modified ? new Date(asset.last_modified).toLocaleString() : "")}</td>
        <td>${url}</td>
      </tr>`;
    }).join("");

    rowsElement.querySelectorAll(".asset-check").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.id;
        if (checkbox.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        renderRows();
      });
    });
    updateCounters();
  };

  const loadAssets = async () => {
    if (isLoading || isDeleting) return;
    let config;
    try { config = getConfig(); }
    catch (error) { setStatus(error.message, "error"); return; }

    isLoading = true;
    loadButton.disabled = true;
    loadButton.textContent = "Loading…";
    setStatus("Retrieving assets. This may take a moment for large environments…");
    setResults("");
    assets = [];
    selectedIds.clear();
    renderRows();

    try {
      const baseUrl = `https://manage.kontent.ai/v2/projects/${encodeURIComponent(config.environmentId)}/assets`;
      let continuationToken = null;
      const seenTokens = new Set();

      do {
        const headers = continuationToken ? { "x-continuation": continuationToken } : {};
        const data = await apiRequest(baseUrl, config.apiKey, { method: "GET", headers });
        if (!data || !Array.isArray(data.assets)) throw new Error("Unexpected response: the assets array was not returned.");

        data.assets.forEach((asset) => {
          assets.push({
            file_name: asset.file_name || "",
            id: asset.id,
            size: asset.size,
            folderId: asset.folder?.id || "No Folder",
            collection: asset.collection?.reference?.codename ||
              asset.collection?.reference?.id ||
              asset.collection?.reference?.external_id || "No Collection",
            url: asset.url || "",
            last_modified: asset.last_modified || ""
          });
        });

        const nextToken = data.pagination?.continuation_token || null;
        if (nextToken && seenTokens.has(nextToken)) throw new Error("Pagination returned a repeated continuation token; loading was stopped to prevent a loop.");
        if (nextToken) seenTokens.add(nextToken);
        continuationToken = nextToken;
        setStatus(`Loaded ${assets.length} assets…`);
      } while (continuationToken);

      renderRows();
      setStatus(`Successfully loaded ${assets.length} assets.`, "success");
    } catch (error) {
      renderRows();
      setStatus(`Unable to load assets: ${error.message}`, "error");
    } finally {
      isLoading = false;
      loadButton.disabled = false;
      loadButton.textContent = "Load assets";
      searchInput.disabled = assets.length === 0;
      updateCounters();
    }
  };

  const deleteSelected = async () => {
    if (isDeleting || !selectedIds.size) return;
    const chosen = assets.filter((asset) => selectedIds.has(asset.id));
    const count = chosen.length;
    const confirmation = window.confirm(
      `Permanently delete ${count} selected asset(s)?\n\nKontent.ai only permits deletion of assets that are not used by content items. This action cannot be undone.`
    );
    if (!confirmation) return;

    let config;
    try { config = getConfig(); }
    catch (error) { setStatus(error.message, "error"); return; }

    isDeleting = true;
    $("deleteButton").disabled = true;
    loadButton.disabled = true;
    let succeeded = 0;
    const failures = [];

    for (let index = 0; index < chosen.length; index++) {
      const asset = chosen[index];
      setResults(`Deleting ${index + 1} of ${count}: ${asset.file_name || asset.id}`);
      try {
        const url = `https://manage.kontent.ai/v2/projects/${encodeURIComponent(config.environmentId)}/assets/${encodeURIComponent(asset.id)}`;
        await apiRequest(url, config.apiKey, { method: "DELETE" });
        succeeded++;
        assets = assets.filter((item) => item.id !== asset.id);
        selectedIds.delete(asset.id);
        renderRows();
      } catch (error) {
        failures.push(`${asset.file_name || asset.id}: ${error.message}`);
      }
    }

    isDeleting = false;
    loadButton.disabled = false;
    renderRows();

    if (failures.length) {
      setResults(`Completed: ${succeeded} deleted, ${failures.length} failed. ${failures.slice(0, 5).join(" | ")}${failures.length > 5 ? " | More failures are not shown." : ""}`, "error");
    } else {
      setResults(`Successfully deleted all ${succeeded} selected asset(s).`, "success");
    }
  };

  const exportCsv = () => {
    const visible = filteredAssets();
    if (!visible.length) return;
    const fields = ["file_name", "id", "size", "folderId", "collection", "url", "last_modified"];
    const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [fields.join(";"), ...visible.map((item) => fields.map((field) => csvCell(item[field])).join(";"))].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "asset_list_export.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };


  // ---------------- Draft content-item management ----------------
  let draftVariants = [];
  const draftSelected = new Set();
  let isDraftLoading = false;
  let isDraftActionRunning = false;

  const setDraftStatus = (message, type = "") => {
    $("draftStatus").textContent = message;
    $("draftStatus").className = `status ${type}`;
  };
  const setDraftResults = (message, type = "") => {
    $("draftActionResults").textContent = message;
    $("draftActionResults").className = `status ${type}`;
  };
  const draftBase = () => `https://manage.kontent.ai/v2/projects/${encodeURIComponent(getConfig().environmentId)}`;
  const draftFilter = () => {
    const term = $("draftSearchInput").value.trim().toLowerCase();
    if (!term) return draftVariants;
    return draftVariants.filter((v) => [v.name, v.codename, v.language, v.contentType, v.collection, v.itemId]
      .some((value) => String(value ?? "").toLowerCase().includes(term)));
  };
  const updateDraftCounters = () => {
    const visible = draftFilter();
    $("draftLoadedCount").textContent = draftVariants.length;
    $("draftVisibleCount").textContent = visible.length;
    $("draftSelectedCount").textContent = draftSelected.size;
    $("draftSelectVisibleButton").disabled = !visible.length || isDraftLoading || isDraftActionRunning;
    $("draftClearSelectionButton").disabled = !draftSelected.size || isDraftActionRunning;
    $("draftDeleteButton").disabled = !draftSelected.size || isDraftActionRunning;
    $("draftArchiveButton").disabled = !draftSelected.size || isDraftActionRunning;
    $("draftExportButton").disabled = !draftVariants.length || isDraftLoading;
    const all = $("draftSelectAll");
    all.disabled = !visible.length || isDraftActionRunning;
    all.checked = visible.length > 0 && visible.every((v) => draftSelected.has(v.key));
    all.indeterminate = visible.some((v) => draftSelected.has(v.key)) && !all.checked;
  };
  const renderDraftRows = () => {
    const visible = draftFilter();
    const tbody = $("draftRows");
    if (!visible.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">${draftVariants.length ? "No draft variants match your search." : "No draft variants loaded."}</td></tr>`;
      updateDraftCounters();
      return;
    }
    tbody.innerHTML = visible.map((v) => {
      const checked = draftSelected.has(v.key);
      return `<tr class="${checked ? "selected" : ""}">
        <td><input class="check draft-check" type="checkbox" data-key="${escapeHtml(v.key)}" ${checked ? "checked" : ""}></td>
        <td class="file">${escapeHtml(v.name)}</td><td class="id">${escapeHtml(v.codename)}</td>
        <td>${escapeHtml(v.language)}</td><td>${escapeHtml(v.contentType)}</td><td>${escapeHtml(v.collection)}</td>
        <td>${escapeHtml(v.lastModified ? new Date(v.lastModified).toLocaleString() : "")}</td><td>${escapeHtml(v.stepCodename || "draft")}</td>
      </tr>`;
    }).join("");
    tbody.querySelectorAll(".draft-check").forEach((checkbox) => checkbox.addEventListener("change", () => {
      if (checkbox.checked) draftSelected.add(checkbox.dataset.key);
      else draftSelected.delete(checkbox.dataset.key);
      renderDraftRows();
    }));
    updateDraftCounters();
  };

  // The filter endpoint returns item/language references; bulk-get retrieves names and workflow metadata.
  const loadDraftVariants = async () => {
    if (isDraftLoading || isDraftActionRunning) return;
    let config;
    try { config = getConfig(); } catch (error) { setDraftStatus(error.message, "error"); return; }
    isDraftLoading = true;
    $("loadDraftsButton").disabled = true;
    $("loadDraftsButton").textContent = "Searching…";
    draftVariants = [];
    draftSelected.clear();
    renderDraftRows();
    setDraftStatus("Finding draft language variants…");
    setDraftResults("");
    const base = `https://manage.kontent.ai/v2/projects/${encodeURIComponent(config.environmentId)}`;
    try {
      const references = [];
      let token = null;
      const seen = new Set();
      do {
        const headers = token ? { "x-continuation": token } : {};
        const page = await apiRequest(`${base}/items-with-variant/filter`, config.apiKey, {
          method: "POST", headers,
          body: JSON.stringify({ filters: { workflow_step: { codename: ["draft"] } }, order: { by: "last_modified", direction: "desc" } })
        });
        if (!page || !Array.isArray(page.variants)) throw new Error("Unexpected filter response: variants array is missing.");
        references.push(...page.variants);
        const next = page.pagination?.continuation_token || null;
        if (next && seen.has(next)) throw new Error("Repeated continuation token received while filtering draft variants.");
        if (next) seen.add(next);
        token = next;
        setDraftStatus(`Found ${references.length} draft variant references…`);
      } while (token);

      // The Management API bulk-get endpoint accepts up to 100 item/language references per request.
      const detailed = [];
      for (let offset = 0; offset < references.length; offset += 100) {
        const batch = references.slice(offset, offset + 100);
        let bulkToken = null;
        const bulkSeen = new Set();
        do {
          const headers = bulkToken ? { "x-continuation": bulkToken } : {};
          const result = await apiRequest(`${base}/items-with-variant/bulk-get`, config.apiKey, {
            method: "POST", headers, body: JSON.stringify({ variants: batch })
          });
          if (!result || !Array.isArray(result.data)) throw new Error("Unexpected bulk-get response: data array is missing.");
          detailed.push(...result.data);
          const next = result.pagination?.continuation_token || null;
          if (next && bulkSeen.has(next)) throw new Error("Repeated continuation token received while retrieving item details.");
          if (next) bulkSeen.add(next);
          bulkToken = next;
        } while (bulkToken);
        setDraftStatus(`Retrieved details for ${detailed.length} of ${references.length} draft variants…`);
      }

      draftVariants = detailed.map((entry) => {
        const item = entry.item || {};
        const variant = entry.variant || {};
        const language = variant.language || {};
        const workflow = variant.workflow || {};
        const step = workflow.step_identifier || variant.workflow_step || {};
        const itemId = item.id || variant.item?.id;
        const languageId = language.id;
        if (!itemId || !languageId) return null;
        return {
          key: `${itemId}::${languageId}`,
          itemId,
          languageId,
          name: item.name || item.codename || itemId,
          codename: item.codename || "",
          language: language.codename || language.id || "",
          contentType: item.type?.codename || item.type?.id || "",
          collection: item.collection?.codename || item.collection?.id || "",
          lastModified: variant.last_modified || item.last_modified || "",
          workflowId: workflow.workflow_identifier?.id || workflow.workflow_identifier?.codename,
          stepCodename: step.codename || "draft"
        };
      }).filter(Boolean);

      // Defensive client-side check: only expose variants whose workflow step is Draft.
      // If the API filter returns non-draft steps, those are excluded rather than made actionable.
      draftVariants = draftVariants.filter((v) => (v.stepCodename || "").toLowerCase() === "draft");
      renderDraftRows();
      setDraftStatus(`Loaded ${draftVariants.length} draft language variant(s).`, "success");
      $("draftSearchInput").disabled = false;
    } catch (error) {
      renderDraftRows();
      setDraftStatus(`Unable to retrieve draft content items: ${error.message}`, "error");
    } finally {
      isDraftLoading = false;
      $("loadDraftsButton").disabled = false;
      $("loadDraftsButton").textContent = "Search draft items";
      updateDraftCounters();
    }
  };

  const runDraftAction = async (action) => {
    if (isDraftActionRunning || !draftSelected.size) return;
    const chosen = draftVariants.filter((v) => draftSelected.has(v.key));
    const verb = action === "delete" ? "permanently delete" : "move to Archived";
    const warning = action === "delete"
      ? "Only the selected language variant will be deleted. If it is the item's last variant, the entire content item will be deleted."
      : "The selected draft language variants will be moved to the Archived workflow step. This requires the workflow transition to be permitted.";
    if (!window.confirm(`Are you sure you want to ${verb} ${chosen.length} selected draft variant(s)?\n\n${warning}`)) return;
    let config;
    try { config = getConfig(); } catch (error) { setDraftStatus(error.message, "error"); return; }

    isDraftActionRunning = true;
    updateDraftCounters();
    let succeeded = 0;
    const failures = [];
    const base = `https://manage.kontent.ai/v2/projects/${encodeURIComponent(config.environmentId)}`;
    for (let index = 0; index < chosen.length; index++) {
      const variant = chosen[index];
      setDraftResults(`${action === "delete" ? "Deleting" : "Archiving"} ${index + 1} of ${chosen.length}: ${variant.name} (${variant.language})`);
      const url = `${base}/items/${encodeURIComponent(variant.itemId)}/variants/${encodeURIComponent(variant.languageId)}`;
      try {
        if (action === "delete") {
          await apiRequest(url, config.apiKey, { method: "DELETE" });
        } else {
          if (!variant.workflowId) throw new Error("Workflow ID is missing from the API response; cannot safely archive this variant.");
          await apiRequest(`${url}/change-workflow`, config.apiKey, {
            method: "PUT",
            body: JSON.stringify({ workflow_identifier: { id: variant.workflowId }, step_identifier: { codename: "archived" } })
          });
        }
        succeeded++;
        draftVariants = draftVariants.filter((v) => v.key !== variant.key);
        draftSelected.delete(variant.key);
        renderDraftRows();
      } catch (error) {
        failures.push(`${variant.name} [${variant.language}]: ${error.message}`);
      }
    }
    isDraftActionRunning = false;
    renderDraftRows();
    if (failures.length) setDraftResults(`Completed: ${succeeded} succeeded, ${failures.length} failed. ${failures.slice(0, 6).join(" | ")}${failures.length > 6 ? " | More failures omitted." : ""}`, "error");
    else setDraftResults(`Successfully ${action === "delete" ? "deleted" : "archived"} ${succeeded} draft variant(s).`, "success");
  };

  const exportDraftCsv = () => {
    const rows = draftFilter();
    if (!rows.length) return;
    const fields = ["name", "codename", "itemId", "language", "languageId", "contentType", "collection", "lastModified", "stepCodename"];
    const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [fields.join(";"), ...rows.map((row) => fields.map((field) => cell(row[field])).join(";"))].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "draft_content_variants.csv";
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  $("assetsTab").addEventListener("click", () => {
    $("assetsPanel").hidden = false; $("draftsPanel").hidden = true;
    $("assetsTab").className = ""; $("draftsTab").className = "secondary";
  });
  $("draftsTab").addEventListener("click", () => {
    $("assetsPanel").hidden = true; $("draftsPanel").hidden = false;
    $("assetsTab").className = "secondary"; $("draftsTab").className = "";
  });
  $("loadDraftsButton").addEventListener("click", loadDraftVariants);
  $("draftSearchInput").addEventListener("input", renderDraftRows);
  $("draftSelectVisibleButton").addEventListener("click", () => { draftFilter().forEach((v) => draftSelected.add(v.key)); renderDraftRows(); });
  $("draftClearSelectionButton").addEventListener("click", () => { draftSelected.clear(); renderDraftRows(); });
  $("draftDeleteButton").addEventListener("click", () => runDraftAction("delete"));
  $("draftArchiveButton").addEventListener("click", () => runDraftAction("archive"));
  $("draftExportButton").addEventListener("click", exportDraftCsv);
  $("draftSelectAll").addEventListener("change", () => {
    draftFilter().forEach((v) => { if ($("draftSelectAll").checked) draftSelected.add(v.key); else draftSelected.delete(v.key); });
    renderDraftRows();
  });


  loadButton.addEventListener("click", loadAssets);
  searchInput.addEventListener("input", renderRows);
  $("selectVisibleButton").addEventListener("click", () => {
    filteredAssets().forEach((asset) => selectedIds.add(asset.id));
    renderRows();
  });
  $("clearSelectionButton").addEventListener("click", () => {
    selectedIds.clear();
    renderRows();
  });
  $("deleteButton").addEventListener("click", deleteSelected);
  $("exportButton").addEventListener("click", exportCsv);
  selectAll.addEventListener("change", () => {
    filteredAssets().forEach((asset) => {
      if (selectAll.checked) selectedIds.add(asset.id);
      else selectedIds.delete(asset.id);
    });
    renderRows();
  });
})();