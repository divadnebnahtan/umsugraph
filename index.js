const elem = document.getElementById("graph");
const Graph = new ForceGraph(elem);
const sidebarToggleButton = document.getElementById("sidebar-toggle");
const sidebarAutoButton = document.getElementById('auto-update-switch');
const searchInput = document.getElementById('search-input');
const searchContainer = document.getElementById('sidebar-search');
const searchSuggestions = document.getElementById('search-suggestions');
const searchResult = document.getElementById('search-result');
const abyssOverlay = document.getElementById('abyss');

let searchSuggestionsIndex = -1;
let searchAllNodes = [];
let filteredSearchSuggestions = [];

var workingData;
let zoomLevel = 0;
let nodeLabelAlphaLevel = '00';
let nodeLabelFontSizeLevel = 0;
let linkLabelAlphaLevel = '00';
let linkLabelFontSizeLevel = 0;

const DATA_FILEPATH = '/umsugraph/assets/default_data.json';
const NODE_RELATIVE_RADIUS = 20;
const GROUPS = [// {name: "test", colour: "#00ff00", radius: 3},
    {name: "club", colour: "#e0b152", radius: 1.5}, {name: "person", colour: "#df5252", radius: 1}, {
        name: "default", colour: "#b3b3b3", radius: 1
    }];
const LINK_COLOUR = "#3f3f3f";

const LINK_DISTANCE = 150;
const LINK_STRENGTH = 2.1;
const CHARGE_STRENGTH = -700;
const CENTER_STRENGTH_MIN = 0.025;
const CENTER_STRENGTH_MAX = 0.045;
const X_CENTER = window.innerWidth / 2;
const Y_CENTER = window.innerHeight / 2;
const ZOOM_TO_FIT_DELAY = 200;
const ZOOM_TO_FIT_DURATION = 250;

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

function getComponents(nodes, links) {
    const visited = new Set();
    const components = [];
    for (const node of nodes) {
        if (!visited.has(node.id)) {
            const queue = [node.id];
            const comp = [];
            visited.add(node.id);
            while (queue.length) {
                const curr = queue.pop();
                comp.push(curr);
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
            components.push(comp);
        }
    }
    return components;
}

function getNodeComponentSize(components) {
    const nodeComponentSize = {};
    components.forEach(comp => {
        comp.forEach(id => {
            nodeComponentSize[id] = comp.length;
        });
    });
    return nodeComponentSize;
}

function getNormalizedStrength(size, minSize, maxSize) {
    return CENTER_STRENGTH_MIN + (CENTER_STRENGTH_MAX - CENTER_STRENGTH_MIN) * ((size - minSize) / (maxSize - minSize + 1e-6));
}

function getQualifyingNodeIds(components, clubs) {
    const clubIdSet = new Set(clubs.map(c => c.id));
    const qualifyingNodeIds = new Set();
    components.forEach(comp => {
        const clubCount = comp.filter(id => clubIdSet.has(id)).length;
        if (clubCount > 1) {
            comp.forEach(id => qualifyingNodeIds.add(id));
        }
    });
    return qualifyingNodeIds;
}

function getGroupPropertyFromTags(tags, property) {
    if (Array.isArray(tags) && tags.length > 0) {
        for (const group of GROUPS) {
            if (tags.includes(group.name)) {
                return group[property] || GROUPS.find(g => g.name === "default")[property];
            }
        }
    }
    // If no tags or no match, use default group
    const defaultGroup = GROUPS.find(g => g.name === "default");
    return defaultGroup && defaultGroup[property] ? defaultGroup[property] : undefined;
}

function alphaToHex(alpha) {
    return Math.round(alpha * 255).toString(16).padStart(2, '0');
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

function linkLabelFontSize(x) {
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
    // let label = link.name;
    // ctx.font = `${linkLabelFontSizeLevel}px Inter`;
    //
    // ctx.textAlign = "center";
    // ctx.textBaseline = "middle";
    // ctx.fillStyle = `#aaaaaa${linkLabelAlphaLevel}`;
    // const midX = (link.source.x + link.target.x) / 2;
    // const midY = (link.source.y + link.target.y) / 2;
    // ctx.fillText(label, midX, midY);

    if (linkLabelAlphaLevel === '00') return;

    const start = link.source;
    const end = link.target;

    // if (typeof start !== 'object' || typeof end !== 'object') return;

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

function setupGraph(elem, nodes, links, nodeComponentSize, minSize, maxSize) {
    Graph.nodeRelSize(20);
    Graph.nodeVal(n => getGroupPropertyFromTags(n.tags, "radius"));
    Graph.nodeColor(n => getGroupPropertyFromTags(n.tags, "colour"));
    Graph.nodeLabel(null);
    Graph.linkColor(() => LINK_COLOUR);
    Graph.linkWidth(2);
    Graph.linkLabel(null);

    Graph.graphData({nodes, links});
    Graph.d3Force('center', null);
    Graph.d3Force('link').distance(LINK_DISTANCE).strength(LINK_STRENGTH);
    Graph.d3Force('charge').strength(CHARGE_STRENGTH);
    Graph.d3Force('x', d3.forceX().strength(0.04));
    Graph.d3Force('y', d3.forceY().strength(0.04));
    Graph.d3Force('x', d3.forceX(X_CENTER)
        .strength(n => getNormalizedStrength(nodeComponentSize[n.id], minSize, maxSize)));
    Graph.d3Force('y', d3.forceY(Y_CENTER)
        .strength(n => getNormalizedStrength(nodeComponentSize[n.id], minSize, maxSize)));

    Graph
        .nodeCanvasObjectMode(() => 'after')
        .nodeCanvasObject(nodeLabelCanvas)
        .linkCanvasObjectMode(() => 'after')
        .linkCanvasObject(linkLabelCanvas);

    Graph.onZoom(zoom => {
        if (zoom.k === zoomLevel) return;
        zoomLevel = zoom.k;

        let nodeFont = nodeLabelFontSize(zoomLevel);
        let nodeOpacity = nodeLabelOpacity(zoomLevel);
        let labelFont = linkLabelFontSize(zoomLevel);
        let labelOpacity = linkLabelOpacity(zoomLevel);

        // let zoomLevelR = zoomLevel.toFixed(2);
        // let labelFontR = labelFont.toFixed(2);
        // let labelOpacityR = labelOpacity.toFixed(2);
        // console.log(`Zoom: ${zoomLevelR}, Font Size: ${labelFontR}, Opacity: ${labelOpacityR}`);

        handleAbyss(zoomLevel);
    });
}

function zoomToFitQualifying(qualifyingNodeIds) {
    setTimeout(() => {
        Graph.zoomToFit(ZOOM_TO_FIT_DURATION, 0, node => true // qualifyingNodeIds.has(node.id)
        );
    }, ZOOM_TO_FIT_DELAY);
}

function getNodesFromData(data) {
    if (!data || !Array.isArray(data.nodes)) return [];
    return data.nodes;
}

function getLinksFromData(data) {
    if (!data || !Array.isArray(data.links)) return [];
    return data.links;
}

function setupAutoButton() {
    let autoUpdate = true;
    sidebarAutoButton.addEventListener('click', () => {
        autoUpdate = !autoUpdate;
        sidebarAutoButton.textContent = autoUpdate ? 'AUTO' : 'MANUAL';
    });
}

function updateSuggestionsList() {
    const inputValue = searchInput.value.trim().toLowerCase();
    filteredSearchSuggestions = inputValue.length === 0 ? [] : searchAllNodes.filter(n => n.name && n.name.toLowerCase().includes(inputValue));
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
            submitSearch(node.name);
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

function submitSearch(query) {
    searchInput.value = '';
    blurSearchInput();

    let nodes = workingData.nodes;
    let node = nodes.find(n => n.name === query);
    if (!node) return;
    let description = node["desc_html"];

    let heading = document.createElement('h2');
    heading.textContent = node.name;

    let descDiv = document.createElement('div');
    descDiv.innerHTML = description;

    let separator = document.createElement('hr');
    separator.classList.add('separator');

    searchResult.innerHTML = '';
    searchResult.appendChild(heading);
    searchResult.appendChild(separator);
    searchResult.appendChild(descDiv);

    Graph.centerAt(node.x, node.y, 600);
}

function setupSearch() {
    document.body.addEventListener('keydown', (e) => {
        if (e.key === '/') {
            e.preventDefault();
            if (isSidebarMinimised()) {
                showSidebar();
            }
            if (!isSearchInputFocused()) {
                searchInput.focus();
            }
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
                    submitSearch(filteredSearchSuggestions[searchSuggestionsIndex].name, Graph);
                }
            }
        }
    });

    searchInput.addEventListener('focus', () => focusSearchInput());
    searchInput.addEventListener('blur', () => blurSearchInput());
}

function isSearchInputFocused() {
    return document.activeElement === searchInput;
}

function focusSearchInput() {
    searchInput.focus();
    if (!searchContainer.classList.contains("search-focused")) {
        searchContainer.classList.add('search-focused');
    }

    searchSuggestionsIndex = 0;
    updateSuggestionsList();
    updateSuggestionsHighlight();
}

function blurSearchInput() {
    searchInput.blur();
    if (searchContainer.classList.contains("search-focused")) {
        searchContainer.classList.remove('search-focused');
    }

    searchSuggestionsIndex = 0;
    updateSuggestionsHighlight();
}

function setupSidebar() {
    sidebarToggleButton.addEventListener("click", () => {
        toggleSidebar();
    });
    hideSidebar();
}

function isSidebarMinimised() {
    return document.body.classList.contains("sidebar-minimised");
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

async function main() {
    try {
        const response = await fetch(DATA_FILEPATH);
        workingData = await response.json();
    } catch (error) {
        console.error('Error fetching data:', error);
        return;
    }
    const nodes = getNodesFromData(workingData);
    searchAllNodes = nodes;
    const links = getLinksFromData(workingData);
    const components = getComponents(nodes, links);
    const nodeComponentSize = getNodeComponentSize(components);
    const maxSize = Math.max(...components.map(c => c.length));
    const minSize = Math.min(...components.map(c => c.length));
    const qualifyingNodeIds = getQualifyingNodeIds(components, nodes.filter(n => n.category === 'club'));
    setupGraph(elem, nodes, links, nodeComponentSize, minSize, maxSize);
    // zoomToFitQualifying(qualifyingNodeIds);

    setupSidebar();
    setupSearch();
    setupAutoButton();
}

main();
