# Data sources

Machine-readable provenance: `data/source_manifest.json` (Jezero, context terrain, Horizons) and `public/data/global/manifest.json` with `data/global_manifest_sources.json` (whole planet). Each entry has the output file, source URL, mission, instrument, download date, checksum, processing steps, projection, resolution and credit. If this page and a manifest disagree, the manifest wins.

## Frame and datum

- Body: Mars 2000 sphere, R = 3,396,190 m. The Cesium planet view uses the IAU ellipsoid (3,396,190 m by 3,376,200 m) for display.
- Longitude east-positive, -180 to 180. Latitude planetocentric.
- Heights: metres above the MOLA areoid. Mars Trek terrain tiles store MOLA height plus 8,201 m; the app subtracts it (tested in `tests/planet/planetMath.test.ts`).
- Jezero 20 m coverage: 77.1605 to 77.6990 E, 18.2110 to 18.7212 N (1596 by 1512 cells, about 32 by 30 km).
- Jezero rasters are cropped to the DEM's outer edges, so a texture coordinate maps to lon/lat with one linear formula.

## Whole planet (Cesium planet view and global layers)

| Layer | Product | Mission / instrument | Resolution | Source | Used for |
| --- | --- | --- | --- | --- | --- |
| 3D terrain | Mars Trek terrain tiles (quantized mesh, `mars_v14`) | JPL Mars Trek | Multi-level | https://marshub.s3.amazonaws.com/mars_v14/ (read at runtime) | Planet surface from orbit to an oblique ground view |
| Base imagery | Viking MDIM 2.1 colourised global mosaic | Viking Orbiters, USGS Astrogeology | 232 m | https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml (read at runtime; 8k and 2k copies in `public/data/global/`) | Colour of the planet |
| Detail imagery | CTX global mosaic, `CTX_beta01_uncontrolled_5m_Caltech` | MRO CTX, Caltech Murray Lab | About 5 m, levels 0 to 12 | Listed in Mars Trek: https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml; tiles from https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer (read at runtime) | Surface detail, fused over Viking colour from tile level 3. The service fails some tiles: HTTP 500 for holes in its cache (retried once) and truncated grayscale PNGs served with HTTP 200 (every row that arrived is decoded, `src/components/Planet/pngSalvage.ts`, and the missing rows are filled from the parent CTX tile). A tile with nothing usable is drawn from its parent CTX tile (up to two levels up), else as Viking colour alone |
| Elevation | MOLA MEGDR 16 ppd, binned to 1/8 degree (`megt90n000eb`) | MGS MOLA | About 7.4 km | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img | Point elevation, landing elevation check, elevation tint |
| Slope | Computed from the MOLA grid (central differences) | MGS MOLA | Baseline about 14.8 km | Same as above | Regional slope (not lander scale) |
| Geology | Geologic Map of Mars, SIM 3292 (Tanaka et al. 2014) | USGS-NASA mapping | 1:20,000,000 | https://pubs.usgs.gov/sim/3292/ | Unit at any point |
| Hydrogen | Water-equivalent hydrogen, smoothed 5x5 degree bins (Boynton et al. 2007) | Mars Odyssey GRS | About 300 km | https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.tab | Regional ground-ice or hydration cue |
| Thermal inertia | Nighttime apparent thermal inertia (Putzig and Mellon 2007) | MGS TES | 20 ppd, about 3 km | https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.img | Load-bearing surface check for landing |
| Dust | Dust cover index (Ruff and Christensen 2002), colourised image | MGS TES, via Mars Trek | About 3.5 km | https://trek.nasa.gov/mars/#v=0.1&x=0&y=0&z=1&p=EQ&i=TES_Dust | Display only. No values are read from it |
| Sites | 54 landing sites and named features | NASA mission pages, Mars Trek bookmarks | Point | `public/data/global/sites.json` (one source URL per site) | Nearest landing site, place names |
| Landing criteria | MSL Landing Site Selection User's Guide to Engineering Constraints (JPL, 2006) | NASA/JPL | n/a | https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf | 8 criteria, each quoted with its section (`public/data/global/landing_criteria.json`) |
| Landing ellipse | Perseverance ellipse, 7.7 by 6.6 km | NASA Science | n/a | https://science.nasa.gov/resource/perseverance-rover-landing-ellipse-in-jezero-crater/ | Monte Carlo ellipse size. Its orientation is not published, so 0 degrees is an assumption |
| EDL timeline | Mars 2020 landing press kit | NASA/JPL | n/a | https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/ | 11 phases with times and altitude triggers (`public/data/global/edl_mars2020.json`) |

## Jezero Crater (20 m scene)

| Layer | Product | Mission / instrument | Resolution | Source | Used for |
| --- | --- | --- | --- | --- | --- |
| Elevation | `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0` | MRO CTX stereo DTM, MOLA-controlled (USGS Astrogeology) | 20 m | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0 | Mesh, slope, routes, line of sight, picking |
| Optical | `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | MRO CTX | 6 m native; base texture 7.8 m, detail tiles at 6 m | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0 | Terrain texture, close views |
| Close-range imagery | MRO HiRISE, Jezero Mosaic, Controlled (`JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`, the Mars 2020 TRN basemap) | MRO HiRISE (NASA/JPL-Caltech/UArizona/USGS via JPL Mars Trek) | 25 cm mosaic read at WMTS level 15: about 1.3 m per pixel near base (1.27 m N-S, 1.21 m E-W), 77.364 to 77.474 E, 18.397 to 18.485 N | https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml (`public/data/hirise/jezero_base.jpg`) | Ground texture at walking and helmet scale around the base, below about 2.6 km camera height |
| Thermal day and night | THEMIS Day IR and Night IR controlled mosaics | Mars Odyssey THEMIS | 100 m nominal (WMTS level 9, 81 m) | https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml and the NightIR equivalent | Relative brightness layers, not calibrated temperature |
| Geology | Geologic map of Jezero crater and the Nili Planum region, SIM 3464 (Sun and Stack 2020) | USGS-NASA mapping | 1:75,000 | https://pubs.usgs.gov/publication/sim3464; features from https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8 and /2 | Unit at a point or stop, landing ellipse outline |
| Waypoints | `M20_waypoints.json` | Mars 2020, NASA MMGIS | Per waypoint | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json | Base position (sol 13 landing waypoint), DEM validation |
| Traverse | Perseverance traverse path | Mars 2020, via Mars Trek | Vector | https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=Perseverance_Traverse_Path | Drive line on the map |
| Rover images | Perseverance raw images | Mars 2020 Mastcam-Z, Navcam, Hazcam | Per image | https://mars.nasa.gov/mars2020/multimedia/raw-images/; API https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N | View from the ground near a target |
| Science sites | 6 catalogued Perseverance sites (for example Séítah, Three Forks sample depot, Cheyava Falls) | NASA mission pages | Point | `public/data/science_sites.json` (one NASA page per site, coordinates from MMGIS waypoints) | Nearest science stop to a target |
| Names | IAU planetary nomenclature | IAU WGPSN, USGS Astrogeology, via Mars Trek | Point | https://planetarynames.wr.usgs.gov/ | Place names |
| Context terrain | MOLA MEGDR 128 ppd (`megt44n000hb`) | MGS MOLA | 463 m | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img | About 175 by 160 km of terrain around the 20 m patch, so the horizon is real |
| Context imagery | CTX global mosaic, WMTS level 9 | MRO CTX, Caltech Murray Lab | About 41 m | As in the global table | Texture of the context terrain |

## Time, sun and Earth

| Item | Source | Used for |
| --- | --- | --- |
| Earth light time 2026 to 2040, daily; Earth azimuth and elevation at Jezero, 10 min (14 to 21 Nov 2026) and 1 h (1 Nov 2026 to 31 Jan 2027) | NASA JPL Horizons, https://ssd.jpl.nasa.gov/horizons/ (API https://ssd.jpl.nasa.gov/api/horizons.api), DE441 and mar099 | Earth light delay in the top bar and report; whether Earth is above the horizon during the EVA. Light time on 15 Nov 2026: 10.95 min one way |
| Mars24 algorithm (Allison and McEwen 2000) | NASA GISS, https://www.giss.nasa.gov/tools/mars24/ | Local solar time, sun elevation, sunset, daylight margin |
| Surface gravity 3.721 m/s^2 | NASA Mars Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | Climb work |

All but the PDS products, MMGIS waypoints, Horizons, Mars24 and the reference documents come through the sources on the challenge Resources tab (JPL Mars Trek, USGS-NASA Planetary Geologic Mapping Program, Perseverance raw images).

## Processing

Scripts in `scripts/`. Raw downloads are cached in `data/raw/` (gitignored). Outputs are committed.

1. `prepare-data.mjs`: DEM read with geotiff.js and stored as row-delta Int16 (0.05 m steps, gzip, `dem.i16.gz`), maximum quantisation error 0.025 m. Ortho cropped to the DEM edges and resampled with sharp. THEMIS tiles stitched and resampled to the DEM extent. SIM 3464 features clipped and rasterised. Waypoints and traverse clipped. Writes `data/source_manifest.json` and `data/validation.json`.
2. `prepare-ctx-tiles.mjs`: the 6 m ortho cut into overlapping 2048 px tiles at native resolution, no resampling.
3. `prepare-context.mjs`: MOLA 128 ppd rows fetched with an HTTP range request, CTX mosaic tiles at level 9, cropped to the context region.
4. `prepare-global.mjs`: MOLA, SIM 3292, GRS, TES products to equirectangular rasters with value files, plus sites and checks. Writes `data/global_validation.json`.
5. `fetch-horizons.mjs`: Horizons observer queries. Mars is a west-positive IAU body, so Jezero's 77.4509 E is passed as -77.4509. Cross-checked against the repo's Mars24 sun model (within 0.1 degree).
6. `prepare-hirise.mjs`: 357 HiRISE WMTS tiles at level 15 stitched and cropped on pixel boundaries (no resampling) to 5120 by 4096 px, radiometrically matched to the CTX 6 m mosaic (linear fit), nodata filled and masked. Adds its entry to `data/source_manifest.json`.
7. `fetch-rover-cache.mjs`: raw-image metadata for about 25 sols along the traverse, so photos show even if the NASA API is slow. At runtime `/api/rover-images` proxies the live API with a 24 h cache.

## Validation

- `data/validation.json`: the 20 m DEM sampled bilinearly at 708 Perseverance waypoints minus each waypoint's recorded elevation. Mean -0.89 m, median -1.06 m, standard deviation 3.25 m, 95th percentile of the absolute residual 6.44 m, maximum 11.72 m. The five largest residuals sit near 77.258 E, 18.462 N (sols 1451 to 1463) on steep ground. The landing waypoint (sol 13) differs by +2.46 m.
- `data/global_validation.json`: the MOLA grid at the Perseverance site is -2,555.7 m against -2,567 m in the 20 m model, a difference of 11.3 m. Olympus Mons maximum 21,159 m and Hellas minimum -8,135 m match the expected values. The SIM 3292 unit at Jezero is HNt.

## Licence and credit notes

- NASA data is generally not copyrighted. Credit used in the app and docs: NASA/JPL-Caltech, NASA/JPL/MSSS/USGS (CTX), NASA/JPL-Caltech/UArizona/USGS (HiRISE), NASA/JPL/ASU (THEMIS, Mastcam-Z), NASA/GSFC (MOLA), USGS Astrogeology, Caltech Murray Lab (CTX global mosaic), NASA JPL Solar System Dynamics (Horizons), NASA GISS (Mars24).
- USGS publications are public domain with credit.
- No NASA logos or insignia are used, and no endorsement is implied. The app says "Not affiliated with NASA".
- Processed derivatives (JPEG, PNG, Int16 grids, JSON) carry the same credits.

## Known data limits

- The 20 m DEM cannot show boulders or metre-scale scarps. Planning slope is the maximum over 2x2 cells, so about 40 m.
- CTX imagery is 6 m per pixel at best. Close views cannot show more than that, and the app does not add synthetic detail.
- Outside Jezero, terrain and slope come from global products. The MOLA grid is about 7.4 km per cell, so the 2 to 5 km landing slope criterion is an estimate scaled from that baseline (marked est.) and the landing Monte Carlo describes the region, not the touchdown spot.
- The CTX global mosaic is uncontrolled, so seams and small offsets can show.
- GRS hydrogen is about 300 km per bin and describes the upper metre at regional scale. High latitudes are not covered.
- THEMIS brightness is relative. The TES dust layer is display only.
- Geologic maps are interpretations at 1:75,000 (Jezero) and 1:20,000,000 (global).
- Rover photos are historic, not live.
