const DATA_FILEPATH = '/umsugraph/assets/default_data.json';
const BASE_URL = "//umsu.unimelb.edu.au";
const NODE_RADIUS = 20;
const NODE_RADIUS_HOVER = 21;
const NODE_BRIGHTEN_FACTOR = 1.2;
const NODE_DARKEN_FACTOR = 0.5;

const LINK_BASE_COLOR = "#aaaab3";
const LINK_BRIGHTEN_FACTOR = 2;
const LINK_DARKEN_FACTOR = 0.5;

const RENDER_LABELS = true;
const LABEL_FONT_SIZE = 16;
const LABEL_OPACITY_DEFAULT = 0;
const LABEL_OPACITY_HOVER = 1;
const LABEL_OPACITY_HOVER_OTHER_MAX = 0.2;
const LABEL_DY_DEFAULT = -28;
const LABEL_DY_HOVER = NODE_RADIUS - NODE_RADIUS_HOVER;
const LABEL_DISPLAY = "block";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const ZOOM_OPACITY_MIN = 0.1;
const ZOOM_OPACITY_MAX = 1;
const SIMULATION_ALPHA_ON_DRAG = 0.3;
const SIMULATION_ALPHA_ON_RESIZE = 0.5;

let sidebar;
let sidebarToggle;
let centerForceSlider;
let repelForceSlider;
let linkForceSlider;
let linkDistanceSlider;
let centerForceValue;
let repelForceValue;
let linkForceValue;
let linkDistanceValue;
let searchInput;
let searchResults;

const categories = {
    person: "#df5252",
    club: "#e0b152",
    default: "#aaaab3"
};

window.onload = function () {
    sidebar = document.getElementById('sidebar');
    sidebarToggle = document.getElementById('sidebar-toggle');
    // Start with sidebar minimized
    sidebar.classList.add('minimized');
    document.body.classList.add('sidebar-minimized');
    sidebarToggle.textContent = '<';
    centerForceSlider = document.getElementById('center-force-slider');
    repelForceSlider = document.getElementById('repel-force-slider');
    linkForceSlider = document.getElementById('link-force-slider');
    linkDistanceSlider = document.getElementById('link-distance-slider');
    centerForceValue = document.getElementById('center-force-value');
    repelForceValue = document.getElementById('repel-force-value');
    linkForceValue = document.getElementById('link-force-value');
    linkDistanceValue = document.getElementById('link-distance-value');
    searchInput = document.getElementById('node-search');
    searchResults = document.getElementById('search-results');

    const svg = d3.select("svg");
    const width = window.innerWidth;
    const height = window.innerHeight;

    let currentZoom = 1;

    async function loadData(url = DATA_FILEPATH, maxNodes = -1) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to load data');
        const data = await response.json();
        if (maxNodes == -1) return data;
        if (!data.nodes || !data.links) throw new Error('data must have nodes and links arrays');
        const limitedNodes = data.nodes.slice(0, maxNodes);
        const nodeIds = new Set(limitedNodes.map(n => n.id));
        const limitedLinks = data.links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));
        const limitedData = { nodes: limitedNodes, links: limitedLinks };
        return limitedData;
    }

    function adjustColorBrightness(hex, factor) {
        // Convert hex to RGB
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        // Convert to HSL
        r /= 255;
        g /= 255;
        b /= 255;
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0;
        } else {
            let d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }
        // Adjust lightness (additive instead of multiplicative for more visible effect)
        l = Math.max(0, Math.min(1, l + (factor - 1) * 0.5));
        // Convert back to RGB
        let hue2rgb = function (p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
        r = Math.round(r * 255);
        g = Math.round(g * 255);
        b = Math.round(b * 255);
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }

    function getNodeBaseColor(node) {
        return categories[node.category] || categories.default;
    }

    function initializeGraph(nodes, links) {
        const container = svg.append("g");

        const zoomBehavior = d3.zoom()
            .scaleExtent([ZOOM_MIN, ZOOM_MAX])
            .on("zoom", (event) => {
                currentZoom = event.transform.k;
                container.attr("transform", event.transform);
                updateLabelsVisibility();
            });
        svg.call(zoomBehavior);

        const radialForce = d3.forceRadial(0, width / 2, height / 2).strength(0);
        const repelForce = d3.forceManyBody().strength(0);
        const linkForce = d3.forceLink(links).id(d => d.id).distance(250).strength(0);

        const simulation = d3.forceSimulation(nodes)
            .force("radial", radialForce)
            .force("link", linkForce)
            .force("charge", repelForce);

        const link = container.append("g")
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("class", "link")
            .attr("stroke", LINK_BASE_COLOR)
            .attr("stroke-width", 3);

        const node = container.append("g")
            .selectAll("circle")
            .data(nodes)
            .join("circle")
            .attr("class", "node")
            .attr("r", NODE_RADIUS)
            .attr("fill", d => getNodeBaseColor(d))
            .style("opacity", 1)
            .call(drag(simulation));

        let label = null;
        if (RENDER_LABELS) {
            label = container.append("g")
                .selectAll("text")
                .data(nodes)
                .join("text")
                .attr("text-anchor", "middle")
                .attr("dy", LABEL_DY_DEFAULT)
                .attr("dx", 0)
                .text(d => d.id)
                .style("opacity", LABEL_OPACITY_DEFAULT)
                .style("display", LABEL_DISPLAY)
                .style("font-size", LABEL_FONT_SIZE + "px");
        }

        node.attr("fill", d => getNodeBaseColor(d)).style("opacity", 1);
        link.attr("stroke", LINK_BASE_COLOR);


        node.on("mouseover", function (event, d) {
            if (RENDER_LABELS && label) {
                d3.select(label.nodes()[nodes.indexOf(d)])
                    .style("opacity", LABEL_OPACITY_HOVER)
                    .attr("dy", LABEL_DY_DEFAULT + LABEL_DY_HOVER);
            }
            d3.select(this).attr("r", NODE_RADIUS_HOVER);
            const neighborIds = new Set([d.id]);
            links.forEach(l => {
                if ((l.source.id ? l.source.id : l.source) === d.id) neighborIds.add(l.target.id ? l.target.id : l.target);
                if ((l.target.id ? l.target.id : l.target) === d.id) neighborIds.add(l.source.id ? l.source.id : l.source);
            });
            node
                .attr("r", n => n.id === d.id ? NODE_RADIUS_HOVER : NODE_RADIUS)
                .attr("fill", n => n.id === d.id
                    ? adjustColorBrightness(getNodeBaseColor(n), NODE_BRIGHTEN_FACTOR)
                    : neighborIds.has(n.id)
                        ? getNodeBaseColor(n)
                        : adjustColorBrightness(getNodeBaseColor(n), NODE_DARKEN_FACTOR))
                .style("opacity", 1);
            link
                .attr("stroke", l => (l.source.id ? l.source.id : l.source) === d.id || (l.target.id ? l.target.id : l.target) === d.id
                    ? adjustColorBrightness(LINK_BASE_COLOR, LINK_BRIGHTEN_FACTOR)
                    : adjustColorBrightness(LINK_BASE_COLOR, LINK_DARKEN_FACTOR));
            if (RENDER_LABELS && label) {
                const zoomOpacity = getZoomOpacity(currentZoom);
                label
                    .style("opacity", (n) => n.id === d.id ? LABEL_OPACITY_HOVER : neighborIds.has(n.id) ? 0.7 : Math.min(zoomOpacity, LABEL_OPACITY_HOVER_OTHER_MAX))
                    .attr("dy", (n) => n.id === d.id ? LABEL_DY_DEFAULT + LABEL_DY_HOVER : LABEL_DY_DEFAULT);
            }
        });
        node.on("mouseout", function (event, d) {
            if (RENDER_LABELS && label) {
                const zoomOpacity = getZoomOpacity(currentZoom);
                d3.select(label.nodes()[nodes.indexOf(d)])
                    .style("opacity", zoomOpacity)
                    .attr("dy", LABEL_DY_DEFAULT);
            }
            d3.select(this).attr("r", NODE_RADIUS);
            node
                .attr("r", NODE_RADIUS)
                .attr("fill", n => getNodeBaseColor(n))
                .style("opacity", 1);
            link.attr("stroke", LINK_BASE_COLOR);
            if (RENDER_LABELS && label) {
                const zoomOpacity = getZoomOpacity(currentZoom);
                label
                    .style("opacity", zoomOpacity)
                    .attr("dy", LABEL_DY_DEFAULT);
            }
        });

        function getZoomOpacity(zoom) {
            return Math.max(0, Math.min(1, (zoom - ZOOM_OPACITY_MIN) / (ZOOM_OPACITY_MAX - ZOOM_OPACITY_MIN)));
        }

        function updateLabelsVisibility() {
            if (RENDER_LABELS && label) {
                const zoomOpacity = getZoomOpacity(currentZoom);
                label.style("opacity", zoomOpacity).attr("dy", LABEL_DY_DEFAULT);
            }
        }

        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node
                .attr("cx", d => d.x)
                .attr("cy", d => d.y);

            if (RENDER_LABELS && label) {
                label
                    .attr("x", d => d.x)
                    .attr("y", d => d.y);
            }
        });

        function drag(simulation) {
            function onDragStart(event, d) {
                if (!event.active) simulation.alphaTarget(SIMULATION_ALPHA_ON_DRAG).restart();
                d.fx = d.x;
                d.fy = d.y;
            }

            function onDrag(event, d) {
                d.fx = event.x;
                d.fy = event.y;
            }

            function onDragEnd(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            }

            return d3.drag()
                .on("start", onDragStart)
                .on("drag", onDrag)
                .on("end", onDragEnd);
        }

        window.addEventListener('resize', () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            svg.attr('width', w).attr('height', h);
            radialForce.x(w / 2).y(h / 2).radius(Math.min(w, h) / 2);
            simulation.alpha(SIMULATION_ALPHA_ON_RESIZE).restart();
        });

        function updateSidebarValues() {
            centerForceValue.textContent = centerForceSlider.value;
            repelForceValue.textContent = repelForceSlider.value;
            linkForceValue.textContent = linkForceSlider.value;
            linkDistanceValue.textContent = linkDistanceSlider.value;
        }

        updateSidebarValues();

        radialForce.strength(+centerForceSlider.value);
        repelForce.strength(-Math.abs(+repelForceSlider.value));
        linkForce.strength(+linkForceSlider.value);
        linkForce.distance(+linkDistanceSlider.value);
        simulation.alpha(0.5).restart();

        centerForceSlider.addEventListener('input', function () {
            radialForce.strength(+this.value);
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        });
        repelForceSlider.addEventListener('input', function () {
            repelForce.strength(-Math.abs(+this.value)); // always negative for repulsion
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        });
        linkForceSlider.addEventListener('input', function () {
            linkForce.strength(+this.value);
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        });
        linkDistanceSlider.addEventListener('input', function () {
            linkForce.distance(+this.value);
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        });

        function debounce(fn, delay) {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => fn.apply(this, args), delay);
            };
        }

        // Debounced force slider handlers
        centerForceSlider.addEventListener('input', debounce(function () {
            radialForce.strength(+this.value);
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        }, 200));
        repelForceSlider.addEventListener('input', debounce(function () {
            repelForce.strength(-Math.abs(+this.value));
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        }, 200));
        linkForceSlider.addEventListener('input', debounce(function () {
            linkForce.strength(+this.value);
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        }, 200));
        linkDistanceSlider.addEventListener('input', debounce(function () {
            linkForce.distance(+this.value);
            simulation.alpha(0.5).restart();
            updateSidebarValues();
        }, 200));

        sidebarToggle.addEventListener('click', function () {
            sidebar.classList.toggle('minimized');
            document.body.classList.toggle('sidebar-minimized');
            sidebarToggle.textContent = sidebar.classList.contains('minimized') ? '<' : '>';
        });

        // Node click: show description in sidebar
        node.on("click", function (event, d) {
            const descContainer = document.getElementById('node-description-container');
            const descDiv = document.getElementById('node-description');
            const nameDiv = document.getElementById('node-name');
            // Clear previous content
            nameDiv.textContent = '';
            if (d.data && d.data.page_link) {
                const a = document.createElement('a');
                a.href = BASE_URL + d.data.page_link;
                a.target = '_blank';
                a.style.color = 'inherit';
                a.style.textDecoration = 'underline';
                a.textContent = d.id;
                nameDiv.appendChild(a);
            } else {
                nameDiv.textContent = d.id;
            }
            let html = '';
            if (d.category === 'person' && d.data) {
                html += '<b>Club Roles:</b><ul style="margin:0 0 8px 0;">';
                for (const [club, roles] of Object.entries(d.data.clubs)) {
                    html += `<li><b>${club}:</b> ${roles.join(', ')}</li>`;
                }
                html += '</ul>';
                if (d.data.profile_html) {
                    html += `<hr style='margin:8px 0;border:none;border-top:1px solid #444;'>`;
                    html += `<div style='margin-top:8px;'>${d.data.profile_html}</div>`;
                }
            } else if (d.category === 'club' && d.data) {
                if (d.data.desc_short) {
                    html += `<div style='margin-bottom:8px;'><b>Description:</b> ${d.data.desc_short}</div>`;
                }
                if (d.data.committee) {
                    html += '<b>Committee:</b><ul style="margin:0;">';
                    for (const [role, people] of Object.entries(d.data.committee)) {
                        html += `<li><b>${role}:</b> ${people.map(x => x.name).join(', ')}</li>`;
                    }
                    html += '</ul>';
                }
            } else {
                html = '(No data)';
            }
            descDiv.innerHTML = html;
            descContainer.style.display = '';
            // If sidebar is minimized, open it
            if (sidebar.classList.contains('minimized')) {
                sidebar.classList.remove('minimized');
                document.body.classList.remove('sidebar-minimized');
                sidebarToggle.textContent = '<';
            }
        });
        // Optional: clicking background hides description
        svg.on('click', function (event) {
            if (event.target === svg.node()) {
                document.getElementById('node-description-container').style.display = 'none';
            }
        });

        // Search bar logic
        searchInput.addEventListener('input', function () {
            const query = this.value.trim().toLowerCase();
            searchResults.innerHTML = '';
            if (!query) return;
            const matches = nodes.filter(n => n.id.toLowerCase().includes(query));
            if (matches.length === 0) {
                searchResults.innerHTML = '<div style="color:#aaa;font-size:14px;">No results</div>';
                return;
            }
            matches.slice(0, 20).forEach(n => {
                const div = document.createElement('div');
                div.textContent = n.id;
                div.style.cursor = 'pointer';
                div.style.padding = '2px 0';
                div.style.fontSize = '15px';
                div.style.color = '#ffe';
                div.addEventListener('click', function (e) {
                    node.filter(d => d.id === n.id).dispatch('click');
                    centerViewOnNode(n);
                    searchResults.innerHTML = '';
                    searchInput.value = '';
                });
                searchResults.appendChild(div);
            });
        });
        // Select top result on Enter
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const query = this.value.trim().toLowerCase();
                if (!query) return;
                const matches = nodes.filter(n => n.id.toLowerCase().includes(query));
                if (matches.length === 0) return;
                const n = matches[0];
                node.filter(d => d.id === n.id).dispatch('click');
                centerViewOnNode(n);
                searchResults.innerHTML = '';
                searchInput.value = '';
            }
        });

        // Helper to center view on a node
        function centerViewOnNode(n) {
            if (typeof n.x !== 'number' || typeof n.y !== 'number') return;
            const svgEl = d3.select('svg');
            const w = window.innerWidth, h = window.innerHeight;
            const k = d3.zoomTransform(svgEl.node()).k;
            const tx = w / 2 - n.x * k;
            const ty = h / 2 - n.y * k;
            svgEl.transition().duration(400).call(
                zoomBehavior.transform,
                d3.zoomIdentity.translate(tx, ty).scale(k)
            );
        }

        updateLabelsVisibility();
    }

    loadData().then(data => {
        window.clubGraphData = data;
        initializeGraph(data.nodes, data.links);
    });

}