workspace "Campfire Allowed Near Me" "Helps users find the closest NSW state forest where campfires are currently legal" {

    !identifiers hierarchical

    configuration {
        scope softwaresystem
    }

    model {

        // ──────────────────────────────────────────────
        // Actors
        // ──────────────────────────────────────────────

        endUser = person "End User" "A person searching for the nearest NSW state forest where campfires are currently legal"
        githubActions = person "GitHub Actions" "Scheduled CI bot that runs the data pipeline twice daily to produce a fresh snapshot" {
            tags "Bot"
        }

        // ──────────────────────────────────────────────
        // External Systems
        // ──────────────────────────────────────────────

        forestryCorporation = softwareSystem "Forestry Corporation NSW" "Cloudflare-protected site listing solid fuel fire ban status and forests directory" {
            tags "External"
        }
        fcnswClosures = softwareSystem "FCNSW Forest Closures" "AWS API Gateway serving closure notices for NSW state forests" {
            tags "External"
        }
        rfsNsw = softwareSystem "RFS NSW" "Rural Fire Service fire danger ratings XML and GeoJSON feeds" {
            tags "External"
        }
        fcnswArcgis = softwareSystem "FCNSW ArcGIS Feature Server" "Official Dedicated State Forest polygon geometries for geocoding" {
            tags "External"
        }
        googleGeocoding = softwareSystem "Google Geocoding API" "Fallback geocoding provider when ArcGIS lookup fails" {
            tags "External"
        }
        nominatim = softwareSystem "OSM Nominatim" "Second fallback geocoding provider (local Docker or public)" {
            tags "External"
        }
        googleRoutes = softwareSystem "Google Routes API" "ComputeRouteMatrix for driving distance and duration" {
            tags "External"
        }
        azureOpenai = softwareSystem "Azure OpenAI" "LLM-based closure impact enrichment from notice text" {
            tags "External"
        }
        decodProxy = softwareSystem "Decodo Residential Proxy" "Australian residential proxy to bypass Cloudflare and AWS IP blocks" {
            tags "External"
        }
        osmTileServer = softwareSystem "OpenStreetMap Tile Server" "Map tile imagery for the Leaflet map" {
            tags "External"
        }

        // ──────────────────────────────────────────────
        // Campfire Allowed Near Me — Core System
        // ──────────────────────────────────────────────

        campfireSystem = softwareSystem "Campfire Allowed Near Me" "Web application that shows the nearest NSW forest where campfires are legal right now" {

            !docs docs
            !adrs decisions

            // ── Web Frontend ──
            webFrontend = container "Web Frontend" "Single-page application that displays an interactive map and forest list with fire ban, closure, and facility filters" "React 19, Vite 7, Mantine v8, Leaflet" {
                tags "Web"

                appShell = component "App Shell" "Top-level orchestrator: manages filters, sort, preferences, query lifecycle and composes all child views" "React, Mantine"
                mapView = component "Map View" "Leaflet map with pane-based markers, viewport culling, zoom-aware budget limiting, and selected-forest popup" "react-leaflet, Leaflet"
                forestListPanel = component "Forest List Panel" "Scrollable virtualised forest list with sort dropdown (distance, driving time)" "TanStack Virtual, Mantine"
                filterPanel = component "Filter Panel" "Multi-dimension filter UI: solid fuel ban, total fire ban, closures, facilities, impact levels, presets" "Mantine"
                forestCardContent = component "Forest Card" "Individual forest detail card showing areas, bans, facilities, closures, distances" "Mantine"
                locationStatusPanels = component "Location Status Panels" "Top cards showing nearest legal campfire and nearest legal campfire with camping" "React, Mantine"
                warningsDialog = component "Warnings Dialog" "Accordion dialog for general warnings, facility mismatch diagnostics, runtime errors" "Mantine"
                settingsDialog = component "Settings Dialog" "User settings panel (avoid tolls, etc.)" "Mantine"

                staticSnapshot = component "Static Snapshot Loader" "Fetches forests-snapshot.json, transforms persisted data to API response, computes haversine distances" "TanStack Query"
                forestFilter = component "Forest Filter" "Pure predicate function that applies all active filter dimensions to a forest entry" "TypeScript"
                routesApiClient = component "Routes API Client" "POST /api/routes to fetch driving distances; batches up to 25 destinations per request" "fetch"
                mapMarkerRendering = component "Map Marker Rendering" "Zoom-aware marker budget calculation and nearest-to-center selection for unmatched markers" "TypeScript"
                drivingRoutesHook = component "Driving Routes Hook" "Fetches and merges driving routes for matching forests via routes proxy" "TanStack Query"
                routeSelectionHeuristic = component "Route Selection Heuristic" "Selects candidate forest IDs for driving route requests using haversine pre-filter" "TypeScript"
                preferencesStore = component "Preferences Store" "Reads and writes user preferences to localStorage" "TypeScript"
            }

            // ── Routes Proxy Worker ──
            routesProxy = container "Routes Proxy Worker" "Cloudflare Worker that proxies driving route requests to Google Routes API with KV caching" "Cloudflare Workers, TypeScript" {
                tags "Worker"

                routeHandler = component "Route Handler" "POST /api/routes handler: validates request, checks KV cache, calls Google, merges and persists results" "Cloudflare Worker"
                kvCache = component "KV Cache Logic" "Co-located caching functions: origin bucketing (~4.4 km grid), 7-day TTL, read/write to Workers KV" "Workers KV"
            }

            // ── Pages Function ──
            pagesFunction = container "Pages Function" "Cloudflare Pages Function that bridges /api/routes POST to the routes-proxy worker via service binding" "Cloudflare Pages Functions" {
                tags "Function"
            }

            // ── Data Pipeline ──
            dataPipeline = container "Data Pipeline" "TypeScript scripts run by GitHub Actions (2x/day) or locally; scrapes, parses, geocodes, enriches, and assembles the snapshot" "Node.js 25, tsx, Playwright, Cheerio, undici" {
                tags "Pipeline"

                generateSnapshot = component "Snapshot Orchestrator" "Runs all pipeline stages sequentially via execFileSync" "TypeScript"

                scrapeForestry = component "Forestry Scraper" "Playwright + stealth + proxy; scrapes fire ban pages and forests directory from Forestry Corp" "Playwright, playwright-extra"
                scrapeClosures = component "Closure Scraper" "Fetches FCNSW closure listing and detail pages via undici ProxyAgent" "undici"
                scrapeTotalFireBan = component "Total Fire Ban Scraper" "Fetches RFS fire danger ratings XML and GeoJSON via plain fetch" "fetch"

                parseForestry = component "Forestry Parser" "Cheerio-based offline parser for fire ban pages and forests directory HTML" "Cheerio"
                parseClosures = component "Closure Parser" "Offline parser for FCNSW closure listing and detail pages" "Cheerio"
                parseTotalFireBan = component "Total Fire Ban Parser" "Offline parser for RFS fire danger ratings and GeoJSON data" "TypeScript"

                geocodeForests = component "Forest Geocoder" "Multi-provider geocoder: FCNSW ArcGIS polygon centroid (primary), Google Geocoding (fallback), Nominatim (fallback)" "TypeScript, SQLite"
                enrichClosures = component "Closure Impact Enricher" "Rules-based and optional LLM enrichment of closure notice text into structured camping/access impact levels" "TypeScript, Azure OpenAI"

                assembleSnapshot = component "Snapshot Assembler" "Combines all intermediates: facility matching, TFB geo-lookup, closure matching, multi-area merge, validation" "TypeScript"
            }

            // ── Data Stores ──
            snapshotFile = container "Forests Snapshot" "Static JSON file served to the frontend containing all forest data, ban statuses, closures, facilities, and coordinates" "JSON file in web/public/" {
                tags "DataStore"
            }
            geocodingCache = container "Geocoding Cache" "SQLite database caching geocode results across pipeline runs; versioned cache key in CI" "SQLite" {
                tags "DataStore" "Database"
            }
            pipelineFileStore = container "Pipeline File Store" "On-disk JSON files: raw page cache (TTL-based), stage intermediates (raw, parsed, geocoded, enriched)" "JSON files in data/" {
                tags "DataStore"
            }
            routesKvStore = container "Routes KV Store" "Cloudflare Workers KV namespace caching Google Routes API responses per origin grid cell with 7-day TTL" "Cloudflare Workers KV" {
                tags "DataStore" "Database"
            }

            // ── Shared Library ──
            sharedLibrary = container "Shared Library" "Pure TypeScript modules: API contracts, domain types, distance helpers, forest merge logic, fuzzy matching — single source of truth for pipeline, functions, and web" "TypeScript" {
                tags "Library"
            }
        }

        // ──────────────────────────────────────────────
        // Relationships — Level 1 (System Context)
        // ──────────────────────────────────────────────

        endUser -> campfireSystem "Searches for forests, views map, applies filters, gets driving directions" "HTTPS"
        githubActions -> campfireSystem "Triggers data pipeline to scrape, parse, geocode, enrich, and publish snapshot" "GitHub Actions workflow"

        campfireSystem -> forestryCorporation "Scrapes fire ban status and forests directory" "HTTPS via Decodo proxy"
        campfireSystem -> fcnswClosures "Scrapes closure notices" "HTTPS via Decodo proxy"
        campfireSystem -> rfsNsw "Fetches fire danger ratings" "HTTPS"
        campfireSystem -> fcnswArcgis "Queries forest polygon geometries for geocoding" "HTTPS REST"
        campfireSystem -> googleGeocoding "Fallback geocoding" "HTTPS"
        campfireSystem -> nominatim "Second fallback geocoding" "HTTP"
        campfireSystem -> googleRoutes "Computes driving distances" "HTTPS"
        campfireSystem -> azureOpenai "LLM closure impact enrichment" "HTTPS"
        campfireSystem -> decodProxy "Routes scraping traffic through residential proxy" "HTTP proxy"
        campfireSystem -> osmTileServer "Loads map tiles" "HTTPS"

        // ──────────────────────────────────────────────
        // Relationships — Level 2 (Container)
        // ──────────────────────────────────────────────

        endUser -> campfireSystem.webFrontend "Views map, applies filters, searches forests" "HTTPS"
        campfireSystem.webFrontend -> campfireSystem.snapshotFile "Fetches forests-snapshot.json at load time" "HTTP GET"
        campfireSystem.webFrontend -> campfireSystem.pagesFunction "Requests driving routes" "POST /api/routes"
        campfireSystem.webFrontend -> osmTileServer "Loads map tile imagery" "HTTPS"

        campfireSystem.pagesFunction -> campfireSystem.routesProxy "Service binding proxy" "Cloudflare service binding"
        campfireSystem.routesProxy -> campfireSystem.routesKvStore "Reads/writes cached route results" "Workers KV API"
        campfireSystem.routesProxy -> googleRoutes "ComputeRouteMatrix for uncached destinations" "HTTPS"

        githubActions -> campfireSystem.dataPipeline "Runs generate-snapshot script" "npx tsx"
        campfireSystem.dataPipeline -> forestryCorporation "Scrapes fire ban and directory pages" "HTTPS via Playwright + Decodo"
        campfireSystem.dataPipeline -> decodProxy "Routes Cloudflare/AWS-blocked requests" "HTTP proxy"
        campfireSystem.dataPipeline -> fcnswClosures "Scrapes closure notices" "HTTPS via undici ProxyAgent"
        campfireSystem.dataPipeline -> rfsNsw "Fetches fire danger ratings XML + GeoJSON" "HTTPS"
        campfireSystem.dataPipeline -> fcnswArcgis "Queries forest polygon geometries" "HTTPS REST"
        campfireSystem.dataPipeline -> googleGeocoding "Fallback geocoding requests" "HTTPS"
        campfireSystem.dataPipeline -> nominatim "Second fallback geocoding" "HTTP"
        campfireSystem.dataPipeline -> azureOpenai "LLM closure impact enrichment" "HTTPS"
        campfireSystem.dataPipeline -> campfireSystem.geocodingCache "Reads/writes geocoding results" "SQLite"
        campfireSystem.dataPipeline -> campfireSystem.pipelineFileStore "Caches raw pages and writes stage checkpoint data" "File I/O"
        campfireSystem.dataPipeline -> campfireSystem.snapshotFile "Writes final assembled snapshot" "File I/O"

        campfireSystem.webFrontend -> campfireSystem.sharedLibrary "Imports contracts, types, domain helpers" "TypeScript import"
        campfireSystem.dataPipeline -> campfireSystem.sharedLibrary "Imports contracts, types, domain helpers" "TypeScript import"

        // ──────────────────────────────────────────────
        // Relationships — Level 3 (Component: Web Frontend)
        // ──────────────────────────────────────────────

        endUser -> campfireSystem.webFrontend.appShell "Interacts with the application" "HTTPS"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.mapView "Renders map with forest markers" "React props"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.forestListPanel "Renders sorted forest list" "React props"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.filterPanel "Manages filter state" "React props"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.locationStatusPanels "Shows nearest legal campfire summary" "React props"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.warningsDialog "Shows warnings and diagnostics" "React props"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.settingsDialog "Shows user settings" "React props"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.staticSnapshot "Triggers snapshot fetch on load" "function call"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.forestFilter "Applies filters to forest data" "function call"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.preferencesStore "Reads/writes user preferences" "function call"

        campfireSystem.webFrontend.forestListPanel -> campfireSystem.webFrontend.forestCardContent "Renders individual forest cards" "React props"
        campfireSystem.webFrontend.mapView -> campfireSystem.webFrontend.mapMarkerRendering "Computes visible markers within zoom budget" "function call"
        campfireSystem.webFrontend.mapView -> osmTileServer "Loads map tiles" "HTTPS"

        campfireSystem.webFrontend.staticSnapshot -> campfireSystem.snapshotFile "Fetches forests-snapshot.json" "HTTP GET"
        campfireSystem.webFrontend.routesApiClient -> campfireSystem.pagesFunction "POST /api/routes" "HTTPS"
        campfireSystem.webFrontend.drivingRoutesHook -> campfireSystem.webFrontend.routesApiClient "Delegates route fetch calls" "function call"
        campfireSystem.webFrontend.drivingRoutesHook -> campfireSystem.webFrontend.routeSelectionHeuristic "Selects candidate forests for route requests" "function call"
        campfireSystem.webFrontend.appShell -> campfireSystem.webFrontend.drivingRoutesHook "Requests driving routes for visible forests" "React hook"

        // ──────────────────────────────────────────────
        // Relationships — Level 3 (Component: Data Pipeline)
        // ──────────────────────────────────────────────

        githubActions -> campfireSystem.dataPipeline.generateSnapshot "Triggers full pipeline run" "npx tsx"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.scrapeForestry "Stage 1a: scrape fire ban + directory" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.scrapeClosures "Stage 1b: scrape closure notices" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.scrapeTotalFireBan "Stage 1c: scrape fire danger ratings" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.parseForestry "Stage 2a: parse forestry HTML" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.parseClosures "Stage 2b: parse closure HTML" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.parseTotalFireBan "Stage 2c: parse fire danger data" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.geocodeForests "Stage 3: geocode forests" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.enrichClosures "Stage 4: enrich closures" "execFileSync"
        campfireSystem.dataPipeline.generateSnapshot -> campfireSystem.dataPipeline.assembleSnapshot "Stage 5: assemble final snapshot" "execFileSync"

        campfireSystem.dataPipeline.scrapeForestry -> forestryCorporation "Scrapes fire ban and directory" "HTTPS via Playwright + Decodo"
        campfireSystem.dataPipeline.scrapeForestry -> decodProxy "Routes traffic through residential proxy" "HTTP proxy"
        campfireSystem.dataPipeline.scrapeForestry -> campfireSystem.pipelineFileStore "Caches raw HTML pages" "File I/O"
        campfireSystem.dataPipeline.scrapeClosures -> fcnswClosures "Scrapes closure notices" "HTTPS via undici ProxyAgent"
        campfireSystem.dataPipeline.scrapeClosures -> decodProxy "Routes traffic through proxy" "HTTP proxy"
        campfireSystem.dataPipeline.scrapeClosures -> campfireSystem.pipelineFileStore "Caches raw HTML pages" "File I/O"
        campfireSystem.dataPipeline.scrapeTotalFireBan -> rfsNsw "Fetches fire danger data" "HTTPS"

        campfireSystem.dataPipeline.parseForestry -> campfireSystem.pipelineFileStore "Writes parsed forestry data" "File I/O"
        campfireSystem.dataPipeline.parseClosures -> campfireSystem.pipelineFileStore "Writes parsed closures" "File I/O"
        campfireSystem.dataPipeline.parseTotalFireBan -> campfireSystem.pipelineFileStore "Writes parsed fire ban data" "File I/O"

        campfireSystem.dataPipeline.geocodeForests -> fcnswArcgis "Queries forest polygons" "HTTPS REST"
        campfireSystem.dataPipeline.geocodeForests -> googleGeocoding "Fallback geocoding" "HTTPS"
        campfireSystem.dataPipeline.geocodeForests -> nominatim "Second fallback geocoding" "HTTP"
        campfireSystem.dataPipeline.geocodeForests -> campfireSystem.geocodingCache "Reads/writes geocode results" "SQLite"
        campfireSystem.dataPipeline.geocodeForests -> campfireSystem.pipelineFileStore "Writes geocoded forests" "File I/O"

        campfireSystem.dataPipeline.enrichClosures -> azureOpenai "LLM-based closure impact analysis" "HTTPS"
        campfireSystem.dataPipeline.enrichClosures -> campfireSystem.pipelineFileStore "Writes enriched closures" "File I/O"

        campfireSystem.dataPipeline.assembleSnapshot -> campfireSystem.pipelineFileStore "Reads all intermediate data" "File I/O"
        campfireSystem.dataPipeline.assembleSnapshot -> campfireSystem.snapshotFile "Writes forests-snapshot.json" "File I/O"

        // ──────────────────────────────────────────────
        // Relationships — Level 3 (Component: Routes Proxy Worker)
        // ──────────────────────────────────────────────

        campfireSystem.pagesFunction -> campfireSystem.routesProxy.routeHandler "Forwards route requests" "Service binding"
        campfireSystem.routesProxy.routeHandler -> campfireSystem.routesProxy.kvCache "Checks/writes cached routes" "function call"
        campfireSystem.routesProxy.routeHandler -> googleRoutes "ComputeRouteMatrix for uncached destinations" "HTTPS"
        campfireSystem.routesProxy.kvCache -> campfireSystem.routesKvStore "Persists to KV namespace" "Workers KV API"
    }

    views {

        // ════════════════════════════════════════════════
        // Level 1 — System Context
        // ════════════════════════════════════════════════

        systemContext campfireSystem "L1_SystemContext" "Level 1: Shows the Campfire Allowed Near Me system in the context of its users and external dependencies" {
            include *
            autoLayout tb
        }

        // ════════════════════════════════════════════════
        // Level 2 — Container
        // ════════════════════════════════════════════════

        container campfireSystem "L2_Containers" "Level 2: Shows the internal containers (deployable units) of the Campfire Allowed Near Me system" {
            include *
            autoLayout tb
        }

        // ════════════════════════════════════════════════
        // Level 3 — Component: Web Frontend
        // ════════════════════════════════════════════════

        component campfireSystem.webFrontend "L3_WebFrontend" "Level 3: Components within the Web Frontend SPA" {
            include *
            autoLayout tb
        }

        // ════════════════════════════════════════════════
        // Level 3 — Component: Data Pipeline
        // ════════════════════════════════════════════════

        component campfireSystem.dataPipeline "L3_DataPipeline" "Level 3: Components within the Data Pipeline" {
            include *
            autoLayout tb
        }

        // ════════════════════════════════════════════════
        // Level 3 — Component: Routes Proxy Worker
        // ════════════════════════════════════════════════

        component campfireSystem.routesProxy "L3_RoutesProxy" "Level 3: Components within the Routes Proxy Worker" {
            include *
            autoLayout lr
        }

        // ════════════════════════════════════════════════
        // Styles
        // ════════════════════════════════════════════════

        styles {

            // Base element style
            element "Element" {
                background #438DD5
                color #ffffff
                fontSize 22
                shape roundedbox
            }

            // Persons
            element "Person" {
                shape person
                background #08427B
            }

            // Bot actors
            element "Bot" {
                shape robot
                background #2D6A4F
            }

            // External systems
            element "External" {
                background #999999
                border dashed
            }

            // Web browser container
            element "Web" {
                shape WebBrowser
            }

            // Worker / edge compute
            element "Worker" {
                shape hexagon
                background #1B9AAA
            }

            // Serverless function
            element "Function" {
                shape hexagon
                background #52B788
            }

            // Data pipeline
            element "Pipeline" {
                shape roundedbox
                background #E76F51
            }

            // Data stores
            element "DataStore" {
                shape cylinder
                background #264653
            }

            // Database-backed stores
            element "Database" {
                shape cylinder
                background #2A9D8F
            }

            // Shared library
            element "Library" {
                shape folder
                background #6C757D
            }

            // Base relationship style
            relationship "Relationship" {
                thickness 2
                color #707070
                style solid
            }
        }
    }

}
