let map = L.map("map").setView([22.3072, 73.1812], 13);

let markers = [];
let selectedLocationMarker = null;
let baseLat = null;
let baseLon = null;
let debounceTimer;
let selectedIndex = -1;
let routingControl = null;

// New variables to prevent glitches and handle instant routing/timer
let fetchController = null; 
let mapClickTimer = null;
let instantLine = null; 
let routeTimerInterval = null; 
let delayedBoxTimeout = null; // Stores the 2-second delay timeout for the nav box

// The map always retains its default, colorful tiles.
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

// Theme Toggle Logic (UI Only)
const toggleSwitch = document.querySelector('#checkbox');
function switchTheme(e) {
    if (e.target.checked) {
        document.body.classList.add('dark-mode');
        document.querySelector('.icon').textContent = "☀️";
    } else {
        document.body.classList.remove('dark-mode');
        document.querySelector('.icon').textContent = "🌙";
    }
}
toggleSwitch.addEventListener('change', switchTheme);

const fuelIcon = L.divIcon({
    html: "<div class='custom-marker'>⛽</div>",
    className: "fuel-emoji-icon",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});

const input = document.getElementById("locationInput");
const suggestionBox = document.getElementById("suggestions");
const clearRouteBtn = document.getElementById("clearRouteBtn"); 

document.getElementById("searchBtn").addEventListener("click", searchLocation);
document.getElementById("locBtn").addEventListener("click", useMyLocation);

input.addEventListener("input", handleAutocomplete);
input.addEventListener("keydown", handleKeyNavigation);

// Clear Route Button Event Listener (Removes the route entirely)
clearRouteBtn.addEventListener("click", function() {
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    if (instantLine) {
        map.removeLayer(instantLine);
        instantLine = null;
    }
    if (routeTimerInterval) clearInterval(routeTimerInterval);
    if (delayedBoxTimeout) clearTimeout(delayedBoxTimeout);
    
    clearRouteBtn.classList.add("hidden");
    
    // Smoothly fly back to your original searched location
    if (baseLat && baseLon) {
        map.flyTo([baseLat, baseLon], 14);
    }
});

// Debounced Map Click to prevent double-click spam
map.on("click", function(e) {
    clearTimeout(mapClickTimer);
    mapClickTimer = setTimeout(() => {
        setLocation(e.latlng.lat, e.latlng.lng);
    }, 150);
});

function setLocation(lat, lon) {
    baseLat = parseFloat(lat);
    baseLon = parseFloat(lon);

    if (selectedLocationMarker) {
        map.removeLayer(selectedLocationMarker);
    }

    selectedLocationMarker = L.marker([baseLat, baseLon]).addTo(map);
    map.flyTo([baseLat, baseLon], 14);
    findPetrolPumps(baseLat, baseLon);
}

function handleAutocomplete() {
    const query = input.value.trim();
    if (query.length < 1) {
        suggestionBox.classList.add("hidden");
        return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`)
            .then(res => res.json())
            .then(data => {
                suggestionBox.innerHTML = "";
                selectedIndex = -1;
                if (data.length === 0) {
                    suggestionBox.classList.add("hidden");
                    return;
                }
                data.forEach(place => {
                    const item = document.createElement("div");
                    item.className = "suggestion-item";
                    item.textContent = place.display_name;
                    item.onclick = () => {
                        input.value = place.display_name;
                        suggestionBox.classList.add("hidden");
                        setLocation(place.lat, place.lon);
                    };
                    suggestionBox.appendChild(item);
                });
                suggestionBox.classList.remove("hidden");
            })
            .catch(err => console.error("Autocomplete error:", err));
    }, 300);
}

function handleKeyNavigation(e) {
    const items = document.querySelectorAll(".suggestion-item");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
    }
    if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    }
    if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        items[selectedIndex].click();
    }

    items.forEach(i => i.classList.remove("active"));
    if (selectedIndex >= 0) items[selectedIndex].classList.add("active");
}

function searchLocation() {
    const place = input.value.trim();
    if (!place) return;
    suggestionBox.classList.add("hidden");

    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`)
        .then(res => res.json())
        .then(data => {
            if (data.length > 0) setLocation(data[0].lat, data[0].lon);
            else alert("Location not found.");
        })
        .catch(err => console.error("Search error:", err));
}

function useMyLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation not supported.");
        return;
    }

    const locBtn = document.getElementById("locBtn");
    const originalText = locBtn.textContent;
    
    // Trigger pulse animation
    locBtn.textContent = "Locating...";
    locBtn.classList.add("loc-loading");

    navigator.geolocation.getCurrentPosition(
        pos => {
            locBtn.textContent = originalText;
            locBtn.classList.remove("loc-loading");
            setLocation(pos.coords.latitude, pos.coords.longitude);
        },
        err => {
            locBtn.textContent = originalText;
            locBtn.classList.remove("loc-loading");
            alert("Unable to retrieve location.");
        }
    );
}

function findPetrolPumps(lat, lon) {
    clearMapData();
    const list = document.getElementById("pumpList");
    const count = document.getElementById("resultCount");
    const loading = document.getElementById("loading");
    const emptyState = document.getElementById("emptyState");

    list.innerHTML = "";
    count.textContent = "(0)";
    emptyState.classList.add("hidden");
    loading.classList.remove("hidden");

    if (fetchController) fetchController.abort();
    fetchController = new AbortController();

    const query = `
    [out:json];
    (
      node["amenity"="fuel"](around:2000,${lat},${lon});
      way["amenity"="fuel"](around:2000,${lat},${lon});
      relation["amenity"="fuel"](around:2000,${lat},${lon});
    );
    out center;
    `;

    fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
        signal: fetchController.signal 
    })
    .then(res => res.json())
    .then(data => {
        loading.classList.add("hidden");
        if (!data.elements || data.elements.length === 0) {
            emptyState.textContent = "No petrol pumps found in this area.";
            emptyState.classList.remove("hidden");
            return;
        }

        let pumps = data.elements.map(p => {
            const pumpLat = p.lat || p.center?.lat;
            const pumpLon = p.lon || p.center?.lon;
            if (!pumpLat || !pumpLon) return null;
            return {
                lat: pumpLat,
                lon: pumpLon,
                name: p.tags?.name || p.tags?.brand || "Unknown Petrol Pump",
                distance: getDistance(lat, lon, pumpLat, pumpLon)
            };
        }).filter(Boolean);

        pumps = pumps.filter((v,i,a)=>a.findIndex(v2=>(v2.lat===v.lat && v2.lon===v.lon))===i);
        pumps.sort((a,b)=>a.distance-b.distance);
        pumps = pumps.slice(0,5);

        count.textContent = `(${pumps.length})`;

        pumps.forEach(pump => {
            const distanceText = pump.distance.toFixed(2) + " km away";
            const marker = L.marker([pump.lat,pump.lon],{icon:fuelIcon}).addTo(map);
            marker.bindPopup(`<b>${pump.name}</b><br>${distanceText}<br><small>Double click for route</small>`);
            markers.push(marker);

            marker.on("click", () => marker.openPopup());
            marker.on("dblclick", () => drawRoute(pump.lat, pump.lon));

            const li = document.createElement("li");
            li.innerHTML = `
                <div class="pump-info">
                    <strong>${pump.name}</strong>
                    <span class="distance">${distanceText}</span>
                </div>
                <div class="go-icon">➔</div>
            `;
            li.onclick = () => {
                marker.openPopup();
                map.flyTo([pump.lat,pump.lon],15);
            };
            li.ondblclick = () => drawRoute(pump.lat,pump.lon);
            list.appendChild(li);
        });
    })
    .catch(err => {
        if (err.name === 'AbortError') return;
        console.error("Overpass API error:", err);
        loading.classList.add("hidden");
        emptyState.textContent = "Error fetching data. Please try again.";
        emptyState.classList.remove("hidden");
    });
}

function drawRoute(destLat, destLon) {
    if (routingControl) map.removeControl(routingControl);
    if (instantLine) map.removeLayer(instantLine);
    if (routeTimerInterval) clearInterval(routeTimerInterval);
    if (delayedBoxTimeout) clearTimeout(delayedBoxTimeout);
    
    // 1. INSTANT VISUAL FEEDBACK
    instantLine = L.polyline([
        [baseLat, baseLon],
        [destLat, destLon]
    ], {
        color: '#0984e3',
        weight: 4,
        opacity: 0.6,
        dashArray: '8, 10'
    }).addTo(map);

    // Bind the tooltip with reverse countdown timer
    instantLine.bindTooltip(`Providing Best Route<br>Please wait... <span id="routeTimer"></span>`, {
        permanent: true,
        className: "calculating-tooltip",
        direction: "center",
        opacity: 0.9
    }).openTooltip();

    map.fitBounds([[baseLat, baseLon], [destLat, destLon]], { padding: [50, 50], animate: false });
    clearRouteBtn.classList.remove("hidden");
    
    // 2. BACKGROUND PROCESSING: Fetch the actual street route
    routingControl = L.Routing.control({
        waypoints: [L.latLng(baseLat, baseLon), L.latLng(destLat, destLon)],
        router: L.Routing.osrmv1({ serviceUrl: "https://router.project-osrm.org/route/v1" }),
        routeWhileDragging: false,
        addWaypoints: false,
        show: true,
        showAlternatives: false, 
        lineOptions: { styles: [{ color: '#0984e3', opacity: 0.9, weight: 6 }] },
        createMarker: () => null
    }).addTo(map);

    // IMMEDIATELY hide the bulky DOM container so it doesn't cause lag while map draws
    const routingBox = document.querySelector('.leaflet-routing-container');
    if (routingBox) {
        routingBox.style.display = 'none';
    }

    // Once the real street route is found and drawn...
    routingControl.on('routesfound', function() {
        if (instantLine) {
            map.removeLayer(instantLine);
            instantLine = null;
        }
        if (routeTimerInterval) {
            clearInterval(routeTimerInterval);
            routeTimerInterval = null;
        }
        
        // 3. DELAYED NAVIGATION BOX: Wait 2-3 seconds after the line is drawn to show instructions
        delayedBoxTimeout = setTimeout(() => {
            const boxToReveal = document.querySelector('.leaflet-routing-container');
            if (boxToReveal) {
                boxToReveal.style.display = 'block';
                boxToReveal.classList.add('fade-in-box'); // Smoothly fade it in
                
                // Add the close button if it isn't there already
                if (!document.querySelector('.close-routing-btn')) {
                    const closeBtn = document.createElement('div');
                    closeBtn.className = 'close-routing-btn';
                    closeBtn.innerHTML = '✖';
                    closeBtn.title = "Hide directions box";
                    closeBtn.onclick = function(e) {
                        e.stopPropagation(); 
                        boxToReveal.style.display = 'none'; 
                    };
                    boxToReveal.appendChild(closeBtn);
                }
            }
        }, 2000); // 2000ms = 2 second delay as requested
    });
}

function clearMapData() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    if (instantLine) {
        map.removeLayer(instantLine);
        instantLine = null;
    }
    if (routeTimerInterval) clearInterval(routeTimerInterval);
    if (delayedBoxTimeout) clearTimeout(delayedBoxTimeout);
    clearRouteBtn.classList.add("hidden");
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
