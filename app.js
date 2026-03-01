(function () {
    "use strict";

    /* ——————————————————————————————————————————————————
       CONFIG
    —————————————————————————————————————————————————— */
    const VIEW = { CARTO: 0, FRANCE: 1, DEPT: 2 };

    const COLORS = {
        Bovins: "#e67e22",
        Porcins: "#e74c3c",
        Ovins: "#27ae60",
        Caprins: "#2980b9",
    };

    const GROUPS = Object.keys(COLORS);

    const FORCE_PARAMS = {
        [VIEW.CARTO]: { pos: 0.15, coll: 0.8, charge: -2, decay: 0.02 },
        [VIEW.FRANCE]: { pos: 0.40, coll: 0.9, charge: -10, decay: 0.015 },
        [VIEW.DEPT]: { pos: 0.50, coll: 0.9, charge: -1, decay: 0.02 },
    };

    const BUBBLE = { rMin: 3, rMax: 38, frMin: 30, frMax: 90, deptFactor: 0.55, pad: 1.5, opacity: 0.72 };
    const PLAY_MS = 1200;

    /* ——————————————————————————————————————————————————
       STATE
    —————————————————————————————————————————————————— */
    const S = {
        raw: [],
        geo: null,
        year: 2010,
        // Opt-in: empty Set = show ALL
        groups: new Set(),
        cats: new Set(),
        view: VIEW.CARTO,
        dept: null,
        playing: false,
        timer: null,
        centroids: {},
        areas: {},
        bubbles: [],
    };

    /* ——————————————————————————————————————————————————
       DOM CACHE
    —————————————————————————————————————————————————— */
    const $ = (id) => document.getElementById(id);
    let svg, gMap, gBubbles, gLabels, path, projection, zoom;

    const DOM = {};
    function cacheDom() {
        ["stage", "ylbl", "yslider", "pbtn", "pico", "france",
            "accordion-menu", "reset-filters",
            "loader", "m-deps", "m-cats", "m-rows", "ticks", "back", "vinfo",
            "tip", "tn", "tl", "tp", "tb", "tw",
            "pie-box", "pie-svg",
            "area-section", "area-svg", "area-legend",
            "area-tooltip", "pie-tooltip",
            "btn-info", "info-modal", "close-modal"].forEach((id) => {
                DOM[id] = $(id);
            });
    }

    /* ——————————————————————————————————————————————————
       1. DATA LOADER
    —————————————————————————————————————————————————— */
    async function loadData() {
        const [raw, geo] = await Promise.all([
            d3.json("data/saa_pra.json"),
            d3.json("data/departements-geo.json"),
        ]);
        S.raw = raw;
        S.geo = geo;

        const deps = new Set(raw.map((d) => d.code_dep));
        const cats = new Set(raw.map((d) => d.categorie));
        DOM["m-deps"].textContent = deps.size;
        DOM["m-cats"].textContent = cats.size;
        DOM["m-rows"].textContent = raw.length.toLocaleString("fr-FR");

        buildCatColorMap();
    }

    const catColorMap = {};
    const catToGroup = {};

    function buildCatColorMap() {
        const byCat = d3.group(S.raw, (d) => d.groupe, (d) => d.categorie);
        byCat.forEach((cats, groupe) => {
            const base = d3.hsl(COLORS[groupe]);
            const catNames = [...cats.keys()].sort();
            const n = catNames.length;
            catNames.forEach((cat, i) => {
                const lightShift = n > 1 ? -0.15 + (0.3 * i / (n - 1)) : 0;
                const hue = base.h + (n > 1 ? -8 + (16 * i / (n - 1)) : 0);
                const c = d3.hsl(hue, Math.max(0.3, base.s - 0.05 + lightShift * 0.3), Math.min(0.75, Math.max(0.35, base.l + lightShift)));
                catColorMap[cat] = c.formatHex();
                catToGroup[cat] = groupe;
            });
        });
    }

    /* ——————————————————————————————————————————————————
       2. GEO ENGINE
    —————————————————————————————————————————————————— */
    function initGeo() {
        const box = DOM.stage.getBoundingClientRect();
        const W = box.width, H = box.height;

        svg = d3.select(DOM.stage)
            .append("svg")
            .attr("viewBox", `0 0 ${W} ${H}`)
            .attr("preserveAspectRatio", "xMidYMid meet");

        gMap = svg.append("g").attr("id", "map");
        gBubbles = svg.append("g").attr("id", "bubbles");
        gLabels = svg.append("g").attr("id", "labels");

        projection = d3.geoConicConformal()
            .center([2.5, 46.5])
            .scale(Math.min(W, H) * 4.2)
            .translate([W / 2, H / 2]);

        path = d3.geoPath().projection(projection);

        const mapTip = document.getElementById("map-tip");

        gMap.selectAll(".dept")
            .data(S.geo.features)
            .join("path")
            .attr("class", "dept")
            .attr("d", path)
            .on("click", (_, d) => onDeptClick(d))
            .on("mouseover", (e, d) => {
                mapTip.textContent = d.properties.nom + " (" + d.properties.code + ")";
                mapTip.style.display = "block";
            })
            .on("mousemove", (e) => {
                mapTip.style.left = e.pageX + 10 + "px";
                mapTip.style.top = e.pageY - 30 + "px";
            })
            .on("mouseout", () => { mapTip.style.display = "none"; });

        S.geo.features.forEach((f) => {
            S.centroids[f.properties.code] = path.centroid(f);
            const b = path.bounds(f);
            S.areas[f.properties.code] = (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]);
        });

        zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", (e) => {
            gMap.attr("transform", e.transform);
            gBubbles.attr("transform", e.transform);
            gLabels.attr("transform", e.transform);
        });
        svg.call(zoom);
        svg.on("dblclick.zoom", zoomReset);

        buildLegend();
    }

    function buildLegend() {
        const el = document.createElement("div");
        el.className = "legend";
        el.innerHTML =
            '<div class="legend-t">Groupes</div>' +
            GROUPS.map((g) => `<div class="legend-i"><div class="legend-c" style="background:${COLORS[g]}"></div><span>${g}</span></div>`).join("") +
            '<div class="legend-t" style="margin-top:6px">Taille = Production</div>';
        DOM.stage.appendChild(el);
    }

    /* ——————————————————————————————————————————————————
       MAP OPACITY PER VIEW
    —————————————————————————————————————————————————— */
    function paintMap() {
        const depts = gMap.selectAll(".dept");

        if (S.view === VIEW.CARTO) {
            depts.attr("opacity", 0.8).attr("fill", "#f0eeec")
                .attr("stroke", "#a8a29e").attr("stroke-width", 0.8);
        } else if (S.view === VIEW.FRANCE) {
            depts.attr("opacity", 0.65).attr("fill", "#f0eeec")
                .attr("stroke", "#a8a29e").attr("stroke-width", 0.5);
        } else {
            depts
                .attr("opacity", (d) => d.properties.code === S.dept ? 1 : 0.3)
                .attr("fill", (d) => d.properties.code === S.dept ? "#fff7ed" : "#f0eeec")
                .attr("stroke", (d) => d.properties.code === S.dept ? "#ea580c" : "#a8a29e")
                .attr("stroke-width", (d) => d.properties.code === S.dept ? 1.5 : 0.4);
        }
    }

    /* ——————————————————————————————————————————————————
       ZOOM HELPERS
    —————————————————————————————————————————————————— */
    function zoomReset() {
        svg.call(zoom.transform, d3.zoomIdentity);
    }

    function zoomTo(feat) {
        const box = DOM.stage.getBoundingClientRect();
        const [[x0, y0], [x1, y1]] = path.bounds(feat);
        const sc = Math.min(8, 0.65 / Math.max((x1 - x0) / box.width, (y1 - y0) / box.height));
        const newTransform = d3.zoomIdentity
            .translate(box.width / 2 - sc * (x0 + x1) / 2, box.height / 2 - sc * (y0 + y1) / 2)
            .scale(sc);
        svg.call(zoom.transform, newTransform);
    }

    /* ——————————————————————————————————————————————————
       3. BUBBLE DATA PER VIEW
    —————————————————————————————————————————————————— */
    function filteredRaw() {
        // Empty Set = show all (opt-in pattern)
        let d = S.raw.filter((r) => r.annee === S.year
            && (S.groups.size === 0 || S.groups.has(r.groupe))
            && (S.cats.size === 0 || S.cats.has(r.categorie))
        );
        return d;
    }

    function cartoBubbles() {
        const grouped = d3.rollup(filteredRaw(),
            (v) => ({
                production: d3.sum(v, (d) => d.production || 0),
                nb_tetes: d3.sum(v, (d) => d.nb_tetes || 0),
                poids_moyen: d3.mean(v, (d) => d.poids_moyen) || 0,
                categorie: S.cats.size > 0 ? (S.cats.size === 1 ? [...S.cats][0] : v[0].groupe) : v[0].groupe,
                departement: v[0].departement,
                region: v[0].region,
            }),
            (d) => d.code_dep, (d) => d.groupe
        );

        const out = [];
        grouped.forEach((gs, code) => {
            const c = S.centroids[code];
            if (!c || isNaN(c[0])) return;
            gs.forEach((a, g) => {
                if (a.production <= 0) return;
                out.push({
                    id: `${code}-${g}`, code_dep: code, groupe: g, ...a,
                    cx: c[0], cy: c[1], x: c[0], y: c[1], type: "carto"
                });
            });
        });
        return out;
    }

    function franceBubbles() {
        const box = DOM.stage.getBoundingClientRect();
        const pos = {
            Bovins: [box.width * 0.28, box.height * 0.30],
            Porcins: [box.width * 0.72, box.height * 0.30],
            Ovins: [box.width * 0.28, box.height * 0.70],
            Caprins: [box.width * 0.72, box.height * 0.70],
        };
        const byG = d3.rollup(filteredRaw(),
            (v) => ({
                production: d3.sum(v, (d) => d.production || 0),
                nb_tetes: d3.sum(v, (d) => d.nb_tetes || 0),
                poids_moyen: d3.mean(v, (d) => d.poids_moyen) || 0,
            }),
            (d) => d.groupe
        );
        const out = [];
        byG.forEach((a, g) => {
            if (a.production <= 0 || (S.groups.size > 0 && !S.groups.has(g))) return;
            const p = pos[g] || [box.width / 2, box.height / 2];
            out.push({
                id: `fr-${g}`, code_dep: "FR", groupe: g, categorie: g,
                departement: "France entière", region: "", ...a,
                cx: p[0], cy: p[1], x: p[0], y: p[1], type: "france"
            });
        });
        return out;
    }

    function deptBubbles() {
        const c = S.centroids[S.dept];
        if (!c) return [];
        let d = S.raw.filter((r) => r.annee === S.year && r.code_dep === S.dept
            && (S.groups.size === 0 || S.groups.has(r.groupe))
            && (S.cats.size === 0 || S.cats.has(r.categorie))
        );
        return d.filter((r) => (r.production || 0) > 0).map((r) => ({
            id: `${r.code_dep}-${r.groupe}-${r.code_cat}`,
            code_dep: r.code_dep, groupe: r.groupe, categorie: r.categorie,
            departement: r.departement, region: r.region,
            production: r.production, nb_tetes: r.nb_tetes, poids_moyen: r.poids_moyen,
            cx: c[0], cy: c[1], x: c[0], y: c[1], type: "detail",
        }));
    }

    /* ——————————————————————————————————————————————————
       4. RENDER BUBBLES
    —————————————————————————————————————————————————— */
    let rScale;

    function render() {
        const data = S.view === VIEW.FRANCE ? franceBubbles()
            : S.view === VIEW.DEPT ? deptBubbles()
                : cartoBubbles();

        // Radius scale
        const mx = d3.max(data, (d) => d.production) || 1;
        if (S.view === VIEW.FRANCE) {
            rScale = d3.scaleSqrt().domain([0, mx]).range([BUBBLE.frMin, BUBBLE.frMax]);
        } else if (S.view === VIEW.DEPT) {
            const a = S.areas[S.dept] || 5000;
            const ma = d3.max(Object.values(S.areas));
            const f = Math.max(0.3, Math.min(1, Math.sqrt(a / ma)));
            rScale = d3.scaleSqrt().domain([0, mx]).range([2, Math.max(10, BUBBLE.rMax * f * BUBBLE.deptFactor)]);
        } else {
            rScale = d3.scaleSqrt().domain([0, mx]).range([BUBBLE.rMin, BUBBLE.rMax]);
        }

        S.bubbles = data;

        resolveForce();

        const sel = gBubbles.selectAll(".bubble").data(S.bubbles, (d) => d.id);

        sel.exit().remove();

        const ent = sel.enter().append("circle")
            .attr("class", "bubble")
            .attr("fill", (d) => COLORS[d.groupe])
            .on("mouseover", tipShow).on("mousemove", tipMove).on("mouseout", tipHide);

        ent.merge(sel)
            .attr("cx", (d) => d.x)
            .attr("cy", (d) => d.y)
            .attr("r", (d) => rScale(d.production))
            .attr("fill", (d) => COLORS[d.groupe])
            .attr("opacity", BUBBLE.opacity);

        renderLabels();
    }

    /* ——— FRANCE LABELS ——— */
    function renderLabels() {
        if (S.view === VIEW.FRANCE) {
            const sel = gLabels.selectAll(".fl").data(S.bubbles, (d) => d.id);
            sel.exit().remove();

            const ent = sel.enter().append("g").attr("class", "fl")
                .attr("pointer-events", "none");
            ent.append("text").attr("class", "fl-n")
                .attr("text-anchor", "middle").attr("dy", "-0.3em")
                .attr("fill", "#fff").attr("font-weight", "700");
            ent.append("text").attr("class", "fl-v")
                .attr("text-anchor", "middle").attr("dy", "1em")
                .attr("fill", "rgba(255,255,255,0.85)").attr("font-weight", "500");

            const m = ent.merge(sel);
            m.attr("transform", (d) => `translate(${d.x},${d.y})`).attr("opacity", 1);
            m.select(".fl-n").text((d) => d.groupe)
                .attr("font-size", (d) => Math.max(12, rScale(d.production) * 0.22) + "px");
            m.select(".fl-v").text((d) => fmt(d.production) + " t")
                .attr("font-size", (d) => Math.max(10, rScale(d.production) * 0.16) + "px");
        } else {
            gLabels.selectAll(".fl").remove();
        }
    }

    /* ——— FORCE  ——— */
    function resolveForce() {
        const fp = FORCE_PARAMS[S.view];

        const sim = d3.forceSimulation(S.bubbles)
            .force("x", d3.forceX((d) => d.cx).strength(fp.pos))
            .force("y", d3.forceY((d) => d.cy).strength(fp.pos))
            .force("collide", d3.forceCollide((d) => rScale(d.production) + BUBBLE.pad).strength(fp.coll).iterations(3))
            .force("charge", d3.forceManyBody().strength(fp.charge))
            .alphaDecay(fp.decay)
            .stop();

        for (let i = 0; i < 300; ++i) sim.tick();
    }

    /* ——————————————————————————————————————————————————
       TOOLTIP
    —————————————————————————————————————————————————— */
    function tipShow(e, d) {
        DOM.tn.textContent = d.categorie;
        DOM.tl.textContent = d.type === "france" ? "France entière" : `${d.departement} — ${d.region}`;
        DOM.tp.textContent = fmt(d.production) + " t";
        DOM.tb.textContent = fmt(d.nb_tetes);
        DOM.tw.textContent = d.poids_moyen ? d.poids_moyen.toFixed(1) + " kg" : "—";
        DOM.tip.classList.add("show");
        gBubbles.selectAll(".bubble").classed("dim", (b) => b.id !== d.id);
    }
    function tipMove(e) { DOM.tip.style.left = e.clientX + 14 + "px"; DOM.tip.style.top = e.clientY - 8 + "px"; }
    function tipHide() { DOM.tip.classList.remove("show"); gBubbles.selectAll(".bubble").classed("dim", false); }
    function fmt(n) { return n == null ? "—" : Math.round(n).toLocaleString("fr-FR"); }
    function pct(n, total) { return total > 0 ? (n / total * 100).toFixed(1) + "%" : "0%"; }

    /* ——————————————————————————————————————————————————
       PIE CHART 
    —————————————————————————————————————————————————— */
    const PIE_R = 100, PIE_IR = 45;
    let pieSvg, pieGroup;

    function initPie() {
        pieSvg = d3.select(DOM["pie-svg"])
            .attr("width", PIE_R * 2 + 30)
            .attr("height", PIE_R * 2 + 30);
        pieGroup = pieSvg.append("g")
            .attr("transform", `translate(${PIE_R + 15},${PIE_R + 15})`);

        // Center text — total
        pieGroup.append("text")
            .attr("class", "pie-total")
            .attr("text-anchor", "middle")
            .attr("dy", "-0.2em")
            .attr("font-family", "sans-serif")
            .attr("font-size", "15px")
            .attr("font-weight", "bold")
            .attr("fill", "#000");

        // Center text — context (year or dept)
        pieGroup.append("text")
            .attr("class", "pie-context")
            .attr("text-anchor", "middle")
            .attr("dy", "1.5em")
            .attr("font-family", "sans-serif")
            .attr("font-size", "11px")
            .attr("fill", "#888");
    }

    function updatePie() {
        let data;
        if (S.view === VIEW.DEPT && S.dept) {
            data = S.raw.filter((r) => r.annee === S.year && r.code_dep === S.dept
                && (S.groups.size === 0 || S.groups.has(r.groupe))
                && (S.cats.size === 0 || S.cats.has(r.categorie)));
        } else {
            data = S.raw.filter((r) => r.annee === S.year
                && (S.groups.size === 0 || S.groups.has(r.groupe))
                && (S.cats.size === 0 || S.cats.has(r.categorie)));
        }

        const byCat = d3.rollup(data, (v) => d3.sum(v, (d) => d.production || 0), (d) => d.categorie);
        const entries = [...byCat.entries()]
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1]);

        const total = d3.sum(entries, (d) => d[1]);

        const pie = d3.pie().value((d) => d[1]).sort(null).padAngle(0.015);
        const arc = d3.arc().innerRadius(PIE_IR).outerRadius(PIE_R);
        const arcs = pie(entries);

        // Instant join 
        const paths = pieGroup.selectAll(".pie-slice").data(arcs, (d) => d.data[0]);

        paths.exit().remove();

        const pieTip = DOM["pie-tooltip"];
        const enter = paths.enter().append("path")
            .attr("class", "pie-slice")
            .on("click", (e, d) => {
                const cat = d.data[0];
                pickCat(cat);
            });

        enter.merge(paths)
            .attr("fill", (d) => catColorMap[d.data[0]] || "#ccc")
            .attr("opacity", 1)
            .attr("d", arc)
            .on("mouseover", function () {
                pieTip.style.display = "block";
            })
            .on("mousemove", function (event, d) {
                const cat = d.data[0];
                const val = d.data[1];
                // Dynamic color from category color map
                const catColor = catColorMap[cat] || "#333";
                pieTip.innerHTML =
                    "<span style=\"color:" + catColor + ";font-weight:bold;\">" + cat + "</span><br>" +
                    "Production : " + fmt(val) + " t<br>" +
                    "Pourcentage : " + pct(val, total);


                const tW = pieTip.offsetWidth;
                const tH = pieTip.offsetHeight;
    
                let xPos = event.pageX + 15;
                let yPos = event.pageY + 15;

                if (event.clientX + 15 + tW > window.innerWidth) {
                    xPos = event.pageX - tW - 15;
                }
                if (event.clientY + 15 + tH > window.innerHeight) {
                    yPos = event.pageY - tH - 15;
                }

                pieTip.style.left = xPos + "px";
                pieTip.style.top = yPos + "px";
            })
            .on("mouseout", function () {
                pieTip.style.display = "none";
            });

        // Center text
        pieGroup.select(".pie-total").text(fmt(total) + " t");
        pieGroup.select(".pie-context").text(
            S.view === VIEW.DEPT && S.dept ? S.dept : String(S.year)
        );
    }

    /* ——————————————————————————————————————————————————
       AREA CHART
    —————————————————————————————————————————————————— */
    let areaXScale, areaChartG;
    const AREA_MARGIN = { top: 24, right: 16, bottom: 22, left: 48 };
    let areaInnerW = 0, areaInnerH = 0;
    let timeTrackerG, timeTrackerLine, timeTrackerText;

    function getGlobalTrendData() {
        const years = d3.range(2010, 2025);
        const activeGroups = S.groups.size > 0 ? [...S.groups] : [...GROUPS];
        let filtered = S.raw.filter((r) => S.groups.size === 0 || S.groups.has(r.groupe));
        if (S.cats.size > 0) filtered = filtered.filter((r) => S.cats.has(r.categorie));

        const nested = d3.rollup(filtered,
            (v) => d3.sum(v, (d) => d.production || 0),
            (d) => d.annee, (d) => d.groupe
        );
        return years.map((y) => {
            const row = { year: y };
            activeGroups.forEach((g) => {
                row[g] = nested.get(y)?.get(g) || 0;
            });
            return row;
        });
    }

    function initAreaChart() {
        const box = DOM["area-section"].getBoundingClientRect();
        const W = box.width - 48;
        const H = box.height - 20;
        areaInnerW = W - AREA_MARGIN.left - AREA_MARGIN.right;
        areaInnerH = H - AREA_MARGIN.top - AREA_MARGIN.bottom;

        const svgEl = d3.select(DOM["area-svg"])
            .attr("viewBox", `0 0 ${W} ${H}`)
            .attr("preserveAspectRatio", "xMidYMid meet");

        areaChartG = svgEl.append("g")
            .attr("transform", `translate(${AREA_MARGIN.left},${AREA_MARGIN.top})`);

        areaXScale = d3.scaleLinear().domain([2010, 2024]).range([0, areaInnerW]);
        areaChartG.append("g")
            .attr("class", "area-axis")
            .attr("transform", `translate(0,${areaInnerH})`)
            .call(d3.axisBottom(areaXScale)
                .ticks(15)
                .tickFormat(d3.format("d"))
                .tickSize(0)
                .tickPadding(6)
            );

        areaChartG.append("g").attr("class", "area-y-axis area-axis area-grid");

        // Time tracker line
        timeTrackerG = areaChartG.append("g").attr("class", "time-tracker");
        timeTrackerLine = timeTrackerG.append("line")
            .attr("y1", 0)
            .attr("y2", areaInnerH)
            .attr("stroke", "#e67e22")
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", "4");
        timeTrackerText = timeTrackerG.append("text")
            .attr("y", -6)
            .attr("text-anchor", "middle")
            .attr("fill", "#e67e22")
            .attr("font-size", "10px")
            .attr("font-weight", "600");
        updateTimeTracker(S.year);
    }

    function updateTimeTracker(annee) {
        if (!areaXScale) return;
        const x = areaXScale(annee);
        timeTrackerLine.attr("x1", x).attr("x2", x);
        timeTrackerText.attr("x", x).text(annee);
    }

    function renderGlobalTrend() {
        if (!areaChartG) return;
        const data = getGlobalTrendData();
        const activeGroups = S.groups.size > 0 ? [...S.groups] : [...GROUPS];

        const stack = d3.stack()
            .keys(activeGroups)
            .order(d3.stackOrderDescending)
            .value((d, key) => d[key] || 0);
        const stacked = stack(data);

        const maxVal = d3.max(stacked, (layer) => d3.max(layer, (d) => d[1])) || 1;
        const yScale = d3.scaleLinear()
            .domain([0, maxVal])
            .range([areaInnerH, 0])
            .nice();

        // Update Y axis
        areaChartG.select(".area-y-axis")
            .call(d3.axisLeft(yScale)
                .ticks(5)
                .tickFormat((d) => {
                    if (d >= 1e6) return (d / 1e6) + "M";
                    if (d >= 1e3) return (d / 1e3) + "k";
                    return d;
                })
                .tickSize(-areaInnerW)
            );

        const areaGen = d3.area()
            .x((d) => areaXScale(d.data.year))
            .y0((d) => yScale(d[0]))
            .y1((d) => yScale(d[1]))
            .curve(d3.curveLinear);

        const lineGen = d3.line()
            .x((d) => areaXScale(d.data.year))
            .y((d) => yScale(d[1]))
            .curve(d3.curveLinear);

        // Areas
        const areaTip = DOM["area-tooltip"];
        const areas = areaChartG.selectAll(".area-path").data(stacked, (d) => d.key);
        areas.exit().remove();
        areas.enter().append("path")
            .attr("class", "area-path")
            .merge(areas)
            .attr("d", areaGen)
            .attr("fill", (d) => COLORS[d.key])
            .attr("opacity", 0.1)
            .on("mouseover", function () {
                areaTip.style.display = "block";
            })
            .on("mousemove", function (event, d) {
                const mouseX = d3.pointer(event, areaChartG.node())[0];
                let year = Math.round(areaXScale.invert(mouseX));
                year = Math.max(2010, Math.min(2024, year));
                const key = d.key;
                const row = data.find((r) => r.year === year);
                const production = row ? (row[key] || 0) : 0;

                // Lookup nb_tetes from raw data
                const tetesData = S.raw.filter((r) => r.annee === year && r.groupe === key);
                const nbTetes = d3.sum(tetesData, (r) => r.nb_tetes || 0);

                // Dynamic color from group color scale
                const groupColor = COLORS[key] || "#333";
                areaTip.innerHTML =
                    "Année : <strong>" + year + "</strong><br>" +
                    "<span style=\"color:" + groupColor + ";font-weight:bold;\">" + key + "</span><br>" +
                    "Production : " + fmt(production) + " t<br>" +
                    "Têtes : " + fmt(nbTetes);

                const tW = areaTip.offsetWidth;
                const tH = areaTip.offsetHeight;

                let xPos = event.pageX + 15;
                let yPos = event.pageY + 15;

                if (event.clientX + 15 + tW > window.innerWidth) {
                    xPos = event.pageX - tW - 15;
                }
                if (event.clientY + 15 + tH > window.innerHeight) {
                    yPos = event.pageY - tH - 15;
                }

                areaTip.style.left = xPos + "px";
                areaTip.style.top = yPos + "px";
            })
            .on("mouseout", function () {
                areaTip.style.display = "none";
            });

        // Stroke lines 
        const lines = areaChartG.selectAll(".area-stroke").data(stacked, (d) => d.key);
        lines.exit().remove();
        lines.enter().append("path")
            .attr("class", "area-stroke")
            .attr("fill", "none")
            .attr("stroke-width", 2)
            .merge(lines)
            .attr("d", lineGen)
            .attr("stroke", (d) => COLORS[d.key])
            .attr("opacity", 1);

        DOM["area-legend"].innerHTML = activeGroups.map((g) =>
            `<div class="area-legend-item">` +
            `<div class="area-legend-dot" style="background:${COLORS[g]}"></div>` +
            `<span>${g}</span></div>`
        ).join("");
    }

    /* ——————————————————————————————————————————————————
       VIEW SWITCHING
    —————————————————————————————————————————————————— */
    function goView(v, code, nom) {
        S.view = v;
        S.dept = v === VIEW.DEPT ? code : null;

        DOM.france.classList.toggle("on", v === VIEW.FRANCE);
        DOM.back.style.display = v === VIEW.DEPT ? "inline-flex" : "none";
        DOM.vinfo.textContent = v === VIEW.FRANCE ? "Vue agrégée par groupe"
            : v === VIEW.DEPT ? nom || "" : "";

        if (v === VIEW.DEPT) {
            const feat = S.geo.features.find((f) => f.properties.code === code);
            if (feat) zoomTo(feat);
        } else {
            zoomReset();
        }

        paintMap();
        updateCharts();
    }

    function onDeptClick(feat) {
        const c = feat.properties.code, n = feat.properties.nom;
        if (S.view === VIEW.DEPT && S.dept === c) goView(VIEW.CARTO);
        else goView(VIEW.DEPT, c, n);
    }

    /* ——————————————————————————————————————————————————
       FILTERS — Accordion Sidebar Menu
    —————————————————————————————————————————————————— */
    function buildSidebarMenu() {
        const grouped = d3.group(S.raw, (d) => d.groupe, (d) => d.categorie);
        const container = DOM["accordion-menu"];
        container.innerHTML = "";

        GROUPS.forEach((g) => {
            const cats = grouped.get(g);
            if (!cats) return;

            const section = document.createElement("div");
            section.className = "accord-group";
            section.dataset.groupe = g;

            const header = document.createElement("button");
            header.className = "accord-header";
            header.style.color = COLORS[g];
            header.innerHTML = `<span class="accord-chevron">›</span>${g}`;
            header.onclick = () => pickGroup(g);

            const body = document.createElement("div");
            body.className = "accord-body";
            [...cats.keys()].sort().forEach((cat) => {
                const btn = document.createElement("button");
                btn.className = "accord-cat";
                btn.textContent = cat;
                btn.dataset.cat = cat;
                btn.onclick = (e) => { e.stopPropagation(); pickCat(cat); };
                body.appendChild(btn);
            });

            section.appendChild(header);
            section.appendChild(body);
            container.appendChild(section);
        });

        DOM["reset-filters"].onclick = () => resetFilters();
    }

    function pickGroup(g) {
        // Toggle: add or remove group from selection
        if (S.groups.has(g)) {
            S.groups.delete(g);
            // Remove categories belonging to this group
            S.cats.forEach((c) => { if (catToGroup[c] === g) S.cats.delete(c); });
        } else {
            S.groups.add(g);
        }
        // Empty Set = show all
        highlightAccordion();
        updateCharts();
    }

    function pickCat(c) {
        // Toggle: add or remove category from selection
        if (S.cats.has(c)) {
            S.cats.delete(c);
        } else {
            S.cats.add(c);
            // Ensure parent group is active
            const parentGroup = catToGroup[c];
            if (parentGroup && S.groups.size > 0) S.groups.add(parentGroup);
        }
        highlightAccordion();
        updateCharts();
    }

    function resetFilters() {
        // Empty = show all
        S.groups.clear();
        S.cats.clear();
        highlightAccordion();
        updateCharts();
    }

    function highlightAccordion() {
        // Empty Set = all shown 
        const showAll = S.groups.size === 0 && S.cats.size === 0;
        DOM["reset-filters"].classList.toggle("on", showAll);

        DOM["accordion-menu"].querySelectorAll(".accord-group").forEach((sec) => {
            const g = sec.dataset.groupe;
            const header = sec.querySelector(".accord-header");
            const body = sec.querySelector(".accord-body");
            const isSelected = S.groups.has(g);

            // Open accordion for selected groups
            header.classList.toggle("open", isSelected);
            header.classList.toggle("active", isSelected);
            body.classList.toggle("open", isSelected);
            header.style.opacity = showAll || isSelected ? "1" : "0.4";

            body.querySelectorAll(".accord-cat").forEach((btn) => {
                btn.classList.toggle("on", S.cats.has(btn.dataset.cat));
            });
        });
    }

    /* ——————————————————————————————————————————————————
       TIMELINE
    —————————————————————————————————————————————————— */
    function buildTimeline() {
        DOM.yslider.oninput = (e) => setYear(+e.target.value);
        DOM.pbtn.onclick = () => S.playing ? stop() : play();

        for (let y = 2010; y <= 2024; y++) {
            const s = document.createElement("span");
            s.className = "tick"; s.textContent = y % 2 === 0 ? String(y).slice(-2) : "";
            DOM.ticks.appendChild(s);
        }
    }

    function setYear(y) {
        S.year = y; DOM.ylbl.textContent = y; DOM.yslider.value = y;
        updateTimeTracker(y);
        updateCharts();
    }

    function play() {
        S.playing = true;
        DOM.pbtn.classList.add("on");
        DOM.pico.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        S.timer = setInterval(() => { let n = S.year + 1; if (n > 2024) n = 2010; setYear(n); }, PLAY_MS);
    }

    function stop() {
        S.playing = false;
        DOM.pbtn.classList.remove("on");
        DOM.pico.innerHTML = '<polygon points="6,4 20,12 6,20"/>';
        clearInterval(S.timer);
    }

    /* ——————————————————————————————————————————————————
       UNIFIED UPDATE
    —————————————————————————————————————————————————— */
    function updateCharts() {
        render();
        updatePie();
        renderGlobalTrend();
    }

    /* ——————————————————————————————————————————————————
       BOOT
    —————————————————————————————————————————————————— */
    async function boot() {
        try {
            cacheDom();
            await loadData();
            initGeo();
            initPie();
            initAreaChart();
            buildSidebarMenu();
            buildTimeline();

            DOM.france.onclick = () => goView(S.view === VIEW.FRANCE ? VIEW.CARTO : VIEW.FRANCE);
            DOM.back.onclick = () => goView(VIEW.CARTO);

            // Info modal
            DOM["btn-info"].addEventListener("click", () => { DOM["info-modal"].style.display = "flex"; });
            DOM["close-modal"].addEventListener("click", () => { DOM["info-modal"].style.display = "none"; });
            DOM["info-modal"].addEventListener("click", (e) => {
                if (e.target === DOM["info-modal"]) DOM["info-modal"].style.display = "none";
            });

            paintMap();
            updateCharts();
            DOM.loader.style.display = "none";
            DOM["info-modal"].style.display = "flex";
        } catch (err) {
            console.error("Boot error:", err);
            DOM.loader.querySelector(".loader-t").textContent = "Erreur: " + err.message;
        }
    }

    boot();
})();
