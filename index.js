const elem = document.getElementById("graph");
const Graph = new ForceGraph(elem);
const db = idb.openDB('umsugraph', 1, {
    upgrade(db) {
        if (!db.objectStoreNames.contains('app')) {
            db.createObjectStore('app');
        }
    }
});

const sidebarToggleButton = document.getElementById("sidebar-toggle");

const dataSection = document.getElementById('data-section');
const groupsSection = document.getElementById('groups-section');
const forcesSection = document.getElementById('forces-section');
const labelsSection = document.getElementById('labels-section');
const storageSection = document.getElementById('storage-section');
const searchSection = document.getElementById('search-section');

const datasetList = document.getElementById('dataset-list');
const uploadDatasetBtn = document.getElementById('upload-dataset-btn');
const updateDatasetsBtn = document.getElementById('update-datasets-btn');

const groupsList = document.getElementById('groups-list');
const addGroupBtn = document.getElementById('add-group-btn');
const searchInput = document.getElementById('search-input');
const searchSuggestions = document.getElementById('search-suggestions');
const searchResult = document.getElementById('search-result');

const storeAutoloadCheckbox = document.getElementById('store-autoload-checkbox');
const storeDataCheckbox = document.getElementById('store-data-checkbox');
const storeGroupsCheckbox = document.getElementById('store-groups-checkbox');
const storeForcesCheckbox = document.getElementById('store-forces-checkbox');
const storeLabelsCheckbox = document.getElementById('store-labels-checkbox');
const saveFileBtn = document.getElementById('save-file-btn');
const loadFileBtn = document.getElementById('load-file-btn');
const saveLocalBtn = document.getElementById('save-local-btn');
const loadLocalBtn = document.getElementById('load-local-btn');

const abyssOverlay = document.getElementById('abyss');

const NODE_RELATIVE_RADIUS = 20;
const DEFAULT_GROUP = {name: "default", colour: "#b3b3b3", radius: 1};
const LINK_COLOUR = "#3f3f3f";

const LINK_DISTANCE = 150;
const LINK_STRENGTH = 2.1;
const CHARGE_STRENGTH = -700;
const XY_STRENGTH_MIN = 0.025;
const XY_STRENGTH_MAX = 0.045;

let searchSuggestionsIndex = -1;
let filteredSearchSuggestions = [];

let workingDataset = {};
let zoomLevel = 0;
let nodeLabelAlphaLevel = '00';
let nodeLabelFontSizeLevel = 0;
let linkLabelAlphaLevel = '00';
let linkLabelFontSizeLevel = 0;

let datasets = [];
let groups = [{tag: "club", colour: "#e0b152", radius: 1.5}, {tag: "person", colour: "#df5252"},];
let forces = {};
let labels = {};

function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
}

function map(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

// coefficients [a0, a1, a2, ...] for a0 + a1*x + a2*x^2 + ...
function polynomial(x, coefficients) {
    return coefficients.reduce((acc, coeff, index) => acc + coeff * Math.pow(x, index), 0);
}

function alphaToHex(alpha) {
    return Math.round(alpha * 255).toString(16).padStart(2, '0');
}

function getClubSubgraphs(dataset, clubs) {
    const clubNodes = dataset.nodes.filter(n => clubs.includes(n.name));
    const subgraphs = getSubgraphs(dataset.nodes, dataset.links);

    let newNodes = [];
    let newLinks = [];

    for (const club of clubNodes) {
        const subgraph = subgraphs.find(sg => sg.includes(club.id));
        newNodes = newNodes.concat(dataset.nodes.filter(n => subgraph.includes(n.id)));
        newLinks = newLinks.concat(dataset.links.filter(l => subgraph.includes(l.source) && subgraph.includes(l.target)));
    }

    return {nodes: newNodes, links: newLinks};
}

// Find connected components (subgraphs) in the graph
// BFS approach
function getSubgraphs(nodes, links) {
    const visited = new Set();
    const subgraphs = [];
    for (const node of nodes) {
        if (!visited.has(node.id)) {
            const queue = [node.id];
            const subgraph = [];
            visited.add(node.id);
            while (queue.length) {
                const curr = queue.pop();
                subgraph.push(curr);
                for (const l of links) {
                    if (l.source === curr && !visited.has(l.target)) {
                        visited.add(l.target);
                        queue.push(l.target);
                    } else if (l.target === curr && !visited.has(l.source)) {
                        visited.add(l.source);
                        queue.push(l.source);
                    }
                }
            }
            subgraphs.push(subgraph);
        }
    }
    return subgraphs;
}

// Calculate "mass" of each subgraph based on node radii
// Returns an array of masses corresponding to subgraphs, although the subgraphs themselves are not returned
function getSubgraphMasses(subgraphs, nodes) {
    // Map node id to node object for quick lookup
    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
    // For each subgraph, sum radius^2 for all nodes
    return subgraphs.map(comp => {
        return comp.reduce((sum, id) => {
            const node = nodeMap[id];
            const radius = getGroupPropertyFromTags(node.tags, "radius");
            return sum + Math.pow(radius, 2);
        }, 0);
    });
}

// Map each node to its subgraph's mass
// Returns an object mapping node id to mass of its subgraph
function getNodeSubgraphMass(subgraphs, subgraphMasses) {
    // Map each node id to its component's mass
    const nodeSubgraphMass = {};
    subgraphs.forEach((subgraph, idx) => {
        subgraph.forEach(id => {
            nodeSubgraphMass[id] = subgraphMasses[idx];
        });
    });
    return nodeSubgraphMass;
}

function getNormalisedSubgraphStrength() {
    // subgraphs = array of arrays of node ids
    const subgraphs = getSubgraphs(workingDataset.nodes, workingDataset.links);

    // subgraphMasses = array of masses corresponding to subgraphs
    const subgraphMasses = getSubgraphMasses(subgraphs, workingDataset.nodes);

    // nodeSubgraphMass = object mapping node id to mass of its subgraph
    const nodeSubgraphMass = getNodeSubgraphMass(subgraphs, subgraphMasses);

    const minMass = Math.min(...subgraphMasses);
    const maxMass = Math.max(...subgraphMasses);

    const normalisedStrengthByMass = {};
    if (minMass === maxMass) {
        // Only one subgraph, avoid division by zero
        const defaultStrength = (XY_STRENGTH_MIN + XY_STRENGTH_MAX) / 2;
        for (const nodeId of Object.keys(nodeSubgraphMass)) {
            normalisedStrengthByMass[nodeId] = defaultStrength;
        }
    } else {
        for (const [nodeId, mass] of Object.entries(nodeSubgraphMass)) {
            normalisedStrengthByMass[nodeId] = map(mass, minMass, maxMass, XY_STRENGTH_MIN, XY_STRENGTH_MAX);
        }
    }
    return normalisedStrengthByMass;
}

function getGroupPropertyFromTags(tags, property) {
    if (!Array.isArray(tags) || tags.length === 0) return DEFAULT_GROUP[property];
    for (const group of groups) {
        if (group[property] !== undefined && tags.includes(group.tag)) {
            return group[property];
        }
    }
    return DEFAULT_GROUP[property];
}

function nodeLabelFontSize(x) {
    let a = 7.88;
    let b = -2.53;
    let c = -23.78;
    let d = 40.17;

    let y = a * Math.sin(b * x) + c * x + d;
    let output = clamp(y, 7, 28)

    nodeLabelFontSizeLevel = output;
    return output;
}

function nodeLabelOpacity(x) {
    let y = polynomial(x, [-0.351, 2.063]);
    let output = clamp(y, 0, 1);

    nodeLabelAlphaLevel = alphaToHex(output);
    return output;
}

function linkLabelFontSize(_x) {
    let y = 8;
    let output = clamp(y, 7, 28);

    linkLabelFontSizeLevel = output;
    return output;
}

function linkLabelOpacity(x) {
    let y = x - 2;
    let output = clamp(y, 0, 1);

    linkLabelAlphaLevel = alphaToHex(output);
    return output;
}

function nodeLabelCanvas(node, ctx) {
    if (nodeLabelAlphaLevel === '00') return;

    let label = node.name;
    ctx.font = `${nodeLabelFontSizeLevel}px Inter`;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `#dadada${nodeLabelAlphaLevel}`;

    const radius = getGroupPropertyFromTags(node.tags, "radius");
    const yOffset = (NODE_RELATIVE_RADIUS - 5) * radius + nodeLabelFontSizeLevel;
    ctx.fillText(label, node.x, node.y + yOffset);
}

function linkLabelCanvas(link, ctx) {
    if (linkLabelAlphaLevel === '00') return;

    const start = link.source;
    const end = link.target;


    const textPos = Object.assign(...['x', 'y'].map(c => ({
        [c]: start[c] + (end[c] - start[c]) / 2
    })));
    const relLink = {x: end.x - start.x, y: end.y - start.y};


    let textAngle = Math.atan2(relLink.y, relLink.x);
    if (textAngle > Math.PI / 2) textAngle = -(Math.PI - textAngle);
    if (textAngle < -Math.PI / 2) textAngle = -(-Math.PI - textAngle);

    const label = link.name;
    ctx.font = `${linkLabelFontSizeLevel}px Inter`;

    ctx.save();
    ctx.translate(textPos.x, textPos.y);
    ctx.rotate(textAngle);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#dadada${linkLabelAlphaLevel}`;
    ctx.fillText(label, 0, 0);
    ctx.restore();
}

function handleAbyss(zoomLevel) {
    abyssOverlay.style.opacity = clamp(map(zoomLevel, 50, 150, 0, 1), 0, 1);

    if (zoomLevel > 950) {
        abyssOverlay.style.opacity = 1;
        Graph.zoom(0.001);
        setTimeout(() => {
            abyssOverlay.style.opacity = 0;
        }, 400);
    }
}

function hideSidebar() {
    document.body.classList.add("sidebar-minimised");

}

function showSidebar() {
    document.body.classList.remove("sidebar-minimised");
}

function toggleSidebar() {
    document.body.classList.toggle("sidebar-minimised");
}

function openSidebarSection(section) {
    section.setAttribute('open', '');
}

function closeSidebarSection(section) {
    section.removeAttribute('open');
}

function setupSidebar() {
    sidebarToggleButton.addEventListener("click", () => {
        toggleSidebar();
    });
    // hideSidebar();
    openSidebarSection(dataSection);
    openSidebarSection(storageSection);
}

function updateSuggestionsList() {
    if (!workingDataset || !workingDataset.nodes || workingDataset.nodes.length === 0) return;
    const inputValue = searchInput.value.trim().toLowerCase();
    filteredSearchSuggestions = inputValue.length === 0 ? [] : workingDataset.nodes.filter(n => n.name && n.name.toLowerCase().includes(inputValue));
    searchSuggestions.innerHTML = '';
    filteredSearchSuggestions.forEach((node, idx) => {
        const el = document.createElement('div');
        el.className = 'search-suggestion';
        el.textContent = node.name;
        el.addEventListener('mouseenter', () => {
            searchSuggestionsIndex = idx;
            updateSuggestionsHighlight();
        });
        el.addEventListener('mouseleave', () => {
            searchSuggestionsIndex = -1;
            updateSuggestionsHighlight();
        });
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            searchSubmit(node.name);
        });
        searchSuggestions.appendChild(el);
    });
    searchSuggestionsIndex = filteredSearchSuggestions.length > 0 ? 0 : -1;
    updateSuggestionsHighlight();
}

function updateSuggestionsHighlight() {
    const suggestions = Array.from(searchSuggestions.getElementsByClassName('search-suggestion'));

    suggestions.forEach((el, idx) => {
        if (idx === searchSuggestionsIndex) {
            el.classList.add('selected');
            el.scrollIntoView({block: 'nearest'});
        } else {
            el.classList.remove('selected');
        }
    });
}

function searchSubmit(query) {
    if (!workingDataset || !Array.isArray(workingDataset.nodes) || workingDataset.nodes.length === 0) {
        return;
    }
    searchInput.value = '';
    blurSearchInput();
    showSearchResult(query);
    let nodes = workingDataset.nodes;
    let node = nodes.find(n => n.name === query);
    Graph.centerAt(node.x, node.y, 600);
}

function showSearchResult(query) {
    if (!workingDataset || !Array.isArray(workingDataset.nodes) || workingDataset.nodes.length === 0) {
        searchResult.innerHTML = '<div class="empty-message">No datasets loaded. Please add a dataset to use search.</div>';
        return;
    }
    let nodes = workingDataset.nodes;
    let node = nodes.find(n => n.name === query);
    if (!node) {
        searchResult.innerHTML = '<div class="empty-message">No matching node found.</div>';
        return;
    }
    let links = (workingDataset.links || []).filter(l => l.source.id === node.id || l.target.id === node.id);
    let description = node["desc_html"];

    let heading = document.createElement('h2');
    heading.textContent = node.name;

    // Group links by their name
    const linksByName = {};
    links.forEach(l => {
        const linkName = l.name;
        if (!linksByName[linkName]) linksByName[linkName] = [];
        linksByName[linkName].push(l);
    });

    let linksUl = document.createElement('div');
    linksUl.classList.add('node-links');
    Object.entries(linksByName).forEach(([linkName, groupLinks]) => {
        // Parent div for the link name
        const groupDiv = document.createElement('div');
        groupDiv.classList.add('node-link-group');
        // Link name as heading/label
        const linkLabel = document.createElement('div');
        linkLabel.classList.add('link-label');
        linkLabel.textContent = linkName;
        groupDiv.appendChild(linkLabel);
        // Bullet list for other node names
        const ul = document.createElement('ul');
        ul.style.margin = '0 0 0 1.5em';
        groupLinks.forEach(l => {
            let otherNodeId = l.source.id === node.id ? l.target.id : l.source.id;
            let otherNode = nodes.find(n => n.id === otherNodeId);
            let li = document.createElement('li');
            let otherNodeLink = document.createElement('a');
            otherNodeLink.href = '#';
            otherNodeLink.textContent = otherNode.name;
            otherNodeLink.addEventListener('click', (e) => {
                e.preventDefault();
                searchSubmit(otherNode.name, Graph);
            });
            li.appendChild(otherNodeLink);
            ul.appendChild(li);
        });
        groupDiv.appendChild(ul);
        linksUl.appendChild(groupDiv);
    });

    let descDiv = document.createElement('div');
    descDiv.innerHTML = description;

    let separator = document.createElement('hr');
    separator.classList.add('separator');

    openSidebarSection(searchSection);
    searchResult.innerHTML = '';
    searchResult.appendChild(heading);
    searchResult.appendChild(linksUl);
    searchResult.appendChild(separator);
    searchResult.appendChild(descDiv);
}

function setupSearch() {
    document.body.addEventListener('keydown', (e) => {
        if (e.key === '/') {
            e.preventDefault();
            showSidebar();
            openSidebarSection(searchSection);
            focusSearchInput();
        } else if (e.key === 'Escape') {
            hideSidebar();
        }
    });

    searchInput.addEventListener('input', updateSuggestionsList);

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredSearchSuggestions.length > 0) {
                searchSuggestionsIndex = (searchSuggestionsIndex + 1) % filteredSearchSuggestions.length;
                updateSuggestionsHighlight();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filteredSearchSuggestions.length > 0) {
                searchSuggestionsIndex = (searchSuggestionsIndex - 1 + filteredSearchSuggestions.length) % filteredSearchSuggestions.length;
                updateSuggestionsHighlight();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredSearchSuggestions.length > 0) {
                if (searchSuggestionsIndex >= 0 && searchSuggestionsIndex < filteredSearchSuggestions.length) {
                    searchSubmit(filteredSearchSuggestions[searchSuggestionsIndex].name, Graph);
                }
            }
        }
    });

    searchInput.addEventListener('focus', () => focusSearchInput());
    searchInput.addEventListener('blur', () => blurSearchInput());
}

function focusSearchInput() {
    searchInput.focus();
    if (!searchSection.classList.contains("search-focused")) {
        searchSection.classList.add('search-focused');
    }

    searchSuggestionsIndex = 0;
    updateSuggestionsList();
    updateSuggestionsHighlight();
}

function blurSearchInput() {
    searchInput.blur();
    if (searchSection.classList.contains("search-focused")) {
        searchSection.classList.remove('search-focused');
    }

    searchSuggestionsIndex = 0;
    updateSuggestionsHighlight();
}

function renderGroups() {
    groupsList.innerHTML = '';
    groups.forEach((group, idx) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group';
        groupDiv.setAttribute('data-group-idx', idx);

        // Handle
        const handle = document.createElement('span');
        handle.className = 'handle';
        handle.innerHTML = '&#x283F;';

        // Tag input
        const tagInput = document.createElement('input');
        tagInput.className = 'group-tag-input ignore-elements';
        tagInput.type = 'text';
        tagInput.placeholder = 'Tag...';
        tagInput.value = group.tag;
        tagInput.addEventListener('input', e => {
            group.tag = e.target.value;
            refreshGraph();
        });

        // Add property button
        const editBtn = document.createElement('button');
        editBtn.className = 'group-edit-btn ignore-elements';
        editBtn.title = 'Add property';
        editBtn.innerHTML = '&#x270E;';
        editBtn.addEventListener('click', () => {
            createGroupPropertyModal(group, renderGroups);
        });

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'group-delete-btn ignore-elements';
        delBtn.title = 'Delete group';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
            groups.splice(idx, 1);
            renderGroups();
        });

        groupDiv.appendChild(handle);
        groupDiv.appendChild(tagInput);
        groupDiv.appendChild(editBtn);
        groupDiv.appendChild(delBtn);
        groupsList.appendChild(groupDiv);
    });
    refreshGraph();
}

function createGroupPropertyModal(group, onClose) {
    // Remove existing modal if present
    const existingModal = document.getElementById('group-property-modal');
    if (existingModal) existingModal.remove();

    // Modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'group-property-modal';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.3)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    // Modal box
    const modal = document.createElement('div');
    modal.style.background = '#222';
    modal.style.padding = '24px 20px 16px 20px';
    modal.style.borderRadius = '10px';
    modal.style.minWidth = '320px';
    modal.style.boxShadow = '0 2px 16px #0008';
    modal.style.color = '#dadada';

    // Title
    const title = document.createElement('h3');
    title.textContent = 'Edit Group Properties (W.I.P)';
    title.style.marginTop = '0';
    modal.appendChild(title);

    // List of current properties
    const propsDiv = document.createElement('div');
    propsDiv.style.marginBottom = '12px';

    function renderProps() {
        propsDiv.innerHTML = '';
        const propKeys = Object.keys(group).filter(k => k === 'colour' || k === 'radius');
        if (propKeys.length === 0) {
            propsDiv.textContent = 'No properties set.';
        } else {
            propKeys.forEach(key => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.marginBottom = '6px';
                // Label
                const label = document.createElement('span');
                label.textContent = key.charAt(0).toUpperCase() + key.slice(1) + ': ';
                label.style.width = '70px';
                // Input
                let input;
                if (key === 'colour') {
                    input = document.createElement('input');
                    input.type = 'color';
                    input.value = group.colour || '#b3b3b3';
                    input.addEventListener('input', e => {
                        group.colour = e.target.value;
                        refreshGraph();
                    });
                } else if (key === 'radius') {
                    input = document.createElement('input');
                    input.type = 'number';
                    input.min = '0.1';
                    input.step = '0.1';
                    input.value = group.radius || 1;
                    input.style.width = '60px';
                    input.addEventListener('input', e => {
                        group.radius = parseFloat(e.target.value) || 1;
                        refreshGraph();
                    });
                }
                // Remove button
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.style.marginLeft = '10px';
                removeBtn.addEventListener('click', () => {
                    delete group[key];
                    renderProps();
                    refreshGraph();
                });
                row.appendChild(label);
                row.appendChild(input);
                row.appendChild(removeBtn);
                propsDiv.appendChild(row);
            });
        }
    }

    renderProps();
    modal.appendChild(propsDiv);

    // Add property section
    const addPropDiv = document.createElement('div');
    addPropDiv.style.display = 'flex';
    addPropDiv.style.alignItems = 'center';
    addPropDiv.style.marginBottom = '10px';
    const propSelect = document.createElement('select');
    propSelect.innerHTML = '<option value="">Add property...</option>' + '<option value="colour">Colour</option>' + '<option value="radius">Radius</option>';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.style.marginLeft = '8px';
    addBtn.addEventListener('click', () => {
        const val = propSelect.value;
        if (!val) return;
        if (val === 'colour' && !group.colour) {
            group.colour = '#b3b3b3';
        } else if (val === 'radius' && !group.radius) {
            group.radius = 1;
        }
        renderProps();
        refreshGraph();
        propSelect.value = '';
    });
    addPropDiv.appendChild(propSelect);
    addPropDiv.appendChild(addBtn);
    modal.appendChild(addPropDiv);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '10px';
    closeBtn.style.float = 'right';
    closeBtn.addEventListener('click', () => {
        overlay.remove();
        if (onClose) onClose();
    });
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function setupGroups() {
    addGroupBtn.addEventListener('click', () => {
        groups.push({tag: ''});
        renderGroups();
    });

    renderGroups();

    new Sortable(groupsList, {
        filter: '.ignore-elements', preventOnFilter: false, animation: 150, onUpdate: (_evt) => {
            const newGroups = [];
            const groupDivs = Array.from(groupsList.children);
            groupDivs.forEach(div => {
                const origIdx = parseInt(div.getAttribute('data-group-idx'), 10);
                newGroups.push(groups[origIdx]);
            });
            groups = newGroups;
            renderGroups();
            console.log("Updated groups");
        }
    });
}

function graphOnZoom(zoom) {
    if (zoom.k === zoomLevel) return;
    zoomLevel = zoom.k;

    nodeLabelFontSize(zoomLevel);
    nodeLabelOpacity(zoomLevel);
    linkLabelFontSize(zoomLevel);
    linkLabelOpacity(zoomLevel);


    handleAbyss(zoomLevel);
}

function graphOnNodeClick(node, _event) {
    showSidebar();
    showSearchResult(node.name);
}

function graphOnBackgroundClick(_event) {
    hideSidebar();
}

function refreshGraph() {
    if (!workingDataset || !Array.isArray(workingDataset.nodes) || workingDataset.nodes.length === 0) {
        // Graph.clear(); does not exist
        // elem.innerHTML = '<div class="empty-message" style="text-align:center;padding:2em;">No datasets loaded.<br>Please add a dataset to view the graph.</div>';
        return;
    }
    Graph.nodeVal(n => getGroupPropertyFromTags(n.tags, "radius"));
    Graph.nodeColor(n => getGroupPropertyFromTags(n.tags, "colour"));
}

function refreshGraphData() {
    // Always provide a valid structure to ForceGraph
    const safeDataset = {
        nodes: Array.isArray(workingDataset.nodes) ? workingDataset.nodes : [],
        links: Array.isArray(workingDataset.links) ? workingDataset.links : []
    };
    Graph.graphData(safeDataset);

    // Only run subgraph logic if there are nodes
    if (safeDataset.nodes.length > 0 && safeDataset.links.length > 0) {
        const normalisedStrengthByMass = getNormalisedSubgraphStrength();
        Graph.d3Force('x', d3.forceX(0).strength(n => normalisedStrengthByMass[n.id]));
        Graph.d3Force('y', d3.forceY(0).strength(n => normalisedStrengthByMass[n.id]));
    }
    refreshGraph();
}

function setupGraph() {
    Graph.nodeRelSize(20);
    Graph.nodeLabel(null);
    Graph.linkColor(() => LINK_COLOUR);
    Graph.linkWidth(2);
    Graph.linkLabel(null);

    Graph.d3Force('center', null);
    Graph.d3Force('link').distance(LINK_DISTANCE).strength(LINK_STRENGTH);
    Graph.d3Force('charge').strength(CHARGE_STRENGTH);

    Graph
        .nodeCanvasObjectMode(() => 'after')
        .nodeCanvasObject(nodeLabelCanvas)
        .linkCanvasObjectMode(() => 'after')
        .linkCanvasObject(linkLabelCanvas);

    Graph.onZoom(graphOnZoom);
    Graph.onNodeClick(graphOnNodeClick);
    Graph.onBackgroundClick(graphOnBackgroundClick);

    refreshGraph();
    refreshGraphData();
}

function updateDatasets() {
    let decodedDatasets = datasets.map(ds => {
        if (!ds.base64) return null;
        try {
            const jsonStr = Base64.decode(ds.base64);
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error('Failed to decode dataset:', ds.name, e);
            return null;
        }
    }).filter(ds => ds !== null);

    const merged = mergeDatasets(decodedDatasets);
    if (merged && Array.isArray(merged.nodes) && Array.isArray(merged.links)) {
        workingDataset = merged;
        refreshGraphData();
    }
}

function refreshDatasetList() {
    datasetList.innerHTML = '';
    datasets.forEach((ds, idx) => {
        const div = document.createElement('div');
        div.className = 'dataset';
        div.setAttribute('data-dataset-idx', idx);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'dataset-name-input ignore-elements';
        nameInput.value = ds.name;
        nameInput.addEventListener('input', e => {
            ds.name = e.target.value;
        });

        // no file input

        const delBtn = document.createElement('button');
        delBtn.className = 'dataset-delete-btn ignore-elements';
        delBtn.title = 'Delete dataset';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
            datasets.splice(idx, 1);
            refreshDatasetList();
        });

        div.appendChild(nameInput);
        div.appendChild(delBtn);
        datasetList.appendChild(div);
    });
}

function mergeDatasets(datasets) {
    function isEmptyValue(val) {
        if (val === null || val === undefined) return true;
        if (typeof val === 'string' && val.trim() === '') return true;
        if (Array.isArray(val) && val.length === 0) return true;
        return typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0;
    }

    if (!Array.isArray(datasets) || datasets.length === 0) {
        return {nodes: [], links: []};
    }

    // Priority: last in array is highest, so process in reverse
    const nodeMap = {};
    const linkMap = {};

    // Helper to generate a key for undirected links
    function undirectedLinkKey(source, target, name) {
        const [a, b] = [source, target].sort();
        return `${a}|${b}|${name || ''}`;
    }

    for (let i = datasets.length - 1; i >= 0; i--) {
        const dataset = datasets[i];
        if (!dataset || !Array.isArray(dataset.nodes) || !Array.isArray(dataset.links)) {
            console.warn('Invalid datum format, skipping:', dataset);
            continue;
        }
        // Merge nodes by id, with negative id logic
        dataset.nodes.forEach(node => {
            if (typeof node.id === 'string' && node.id.startsWith('-')) {
                // Remove the positive version if it exists, do not add the negative node
                const posId = node.id.slice(1);
                if (nodeMap[posId]) {
                    delete nodeMap[posId];
                }

                Object.keys(linkMap).forEach(linkKey => {
                    const link = linkMap[linkKey];
                    if (link.source === posId || link.target === posId) {
                        delete linkMap[linkKey];
                    }
                });

                return;
            }
            if (!nodeMap[node.id]) {
                nodeMap[node.id] = {...node};
            } else {
                const existing = nodeMap[node.id];
                const merged = {...existing};
                // Merge all properties except tags
                for (const key of Object.keys(node)) {
                    if (key === 'tags') continue;
                    const newVal = node[key];
                    if (!isEmptyValue(newVal)) {
                        merged[key] = newVal;
                    }
                }
                // Merge tags as before
                const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
                const newTags = Array.isArray(node.tags) ? node.tags : [];
                let mergedTags = Array.from(new Set([...existingTags, ...newTags]));
                newTags.forEach(tag => {
                    if (typeof tag === 'string' && tag.startsWith('-')) {
                        const posTag = tag.slice(1);
                        mergedTags = mergedTags.filter(t => t !== posTag);
                    }
                });
                mergedTags = mergedTags.filter(t => !(typeof t === 'string' && t.startsWith('-')));
                merged.tags = mergedTags;
                nodeMap[node.id] = merged;
            }
        });
        // Merge links by unique key (undirected, source-target-name)
        dataset.links.forEach(link => {
            const isNegative = typeof link.name === 'string' && link.name.startsWith('-');
            const baseName = isNegative ? link.name.slice(1) : link.name;
            const key = undirectedLinkKey(link.source, link.target, baseName);
            if (isNegative) {
                if (linkMap[key]) {
                    delete linkMap[key];
                }
            } else {
                if (!linkMap[key]) {
                    linkMap[key] = {...link};
                } else {
                    const existing = linkMap[key];
                    const merged = {...existing};
                    for (const prop of Object.keys(link)) {
                        const newVal = link[prop];
                        if (!isEmptyValue(newVal)) {
                            merged[prop] = newVal;
                        }
                    }
                    linkMap[key] = merged;
                }
            }
        });


    }

    const mergedNodes = Object.values(nodeMap);
    const mergedLinks = Object.values(linkMap);

    return {nodes: mergedNodes, links: mergedLinks};
}

function setupDatasets() {
    uploadDatasetBtn.addEventListener('change', (event) => {
        let files = event.target.files;
        if (!files || files.length === 0) return;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();
            reader.onload = e => {
                const text = e.target.result;
                // const jsonData = JSON.parse(text);
                const base64Data = Base64.encode(text);
                datasets.push({name: file.name, base64: base64Data});
                refreshDatasetList();
            };

            reader.readAsText(file, 'UTF-8');
        }
    });

    updateDatasetsBtn.addEventListener('click', updateDatasets);

    new Sortable(datasetList, {
        filter: '.ignore-elements', preventOnFilter: false, animation: 150, onUpdate: (_evt) => {
            const newDatasets = [];
            const datasetDivs = Array.from(datasetList.children);
            datasetDivs.forEach(div => {
                const origIdx = parseInt(div.getAttribute('data-dataset-idx'), 10);
                newDatasets.push(datasets[origIdx]);
            });

            datasets = newDatasets;
            refreshDatasetList();
        }
    });
}

async function saveIDB(items) {
    (await db).put("app", items, "state");
    console.log("Saved to IndexedDB");
}

async function loadIDB() {
    return ((await db).get("app", "state")) || {};
}

function saveFile(items, filename) {
    let downloadElement = document.createElement('a');
    downloadElement.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(items)));
    downloadElement.setAttribute('download', filename);

    downloadElement.style.display = 'none';
    document.body.appendChild(downloadElement);
    downloadElement.click();
    document.body.removeChild(downloadElement);
}

function applyStorageItems(items) {
    if (items.data) {
        datasets = items.data;
        refreshDatasetList();
        updateDatasets();
    }
    if (items.groups) {
        groups = items.groups;
        renderGroups();
    }
    if (items.forces) {
        forces = items.forces;
        // setupForces();
    }
    if (items.labels) {
        labels = items.labels;
        // setupLabels();
    }
}

function buildStorageItems() {
    let items = {};
    items.autoload = storeAutoloadCheckbox.checked;
    if (storeDataCheckbox.checked) {
        items.data = datasets;
    }
    if (storeGroupsCheckbox.checked) {
        items.groups = groups;
    }
    if (storeForcesCheckbox.checked) {
        items.forces = forces;
    }
    if (storeLabelsCheckbox.checked) {
        items.labels = labels;
    }
    return items;
}

function setupStorage() {
    // check query params for a link to load
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state');

    if (state) {
        const url = "api/proxy?url=" + encodeURIComponent(state);
        fetch(url).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        }).then(data => {
            applyStorageItems(data);
            params.delete('state');

            if (params.get("autosave")) {
                saveIDB(data).then(() => params.delete('autosave'));
            }
        }).catch(err => {
            console.error("Failed to load state from URL:", err);
            alert("Failed to load state from URL. See console for details.");
        });
    } else {
        loadIDB().then(items => {
            if (items && items.autoload) {
                applyStorageItems(items);
            }
        });
    }

    saveLocalBtn.addEventListener('click', () => {
        saveIDB(buildStorageItems()).then(() => alert("Saved to local storage."));
    });
    loadLocalBtn.addEventListener('click', () => {
        loadIDB().then(applyStorageItems);
    });

    saveFileBtn.addEventListener('click', () => {
        let time = new Date().toISOString().replace(/[:.]/g, '-');
        saveFile(buildStorageItems(), `umsugraph-state-${time}.json`);
    });

    loadFileBtn.addEventListener('change', event => {
        let file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const text = e.target.result;
                const items = JSON.parse(text);
                applyStorageItems(items);
                alert("Loaded from file.");
            } catch (err) {
                console.error("Failed to load file:", err);
                alert("Failed to load file. See console for details.");
            }
        };

        reader.readAsText(file, 'UTF-8');
    });
}

setupDatasets();
setupGroups();
// setupForces();
// setupLabels();
setupStorage();
setupSearch();
setupSidebar();
setupGraph();
