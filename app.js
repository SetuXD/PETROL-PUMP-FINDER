let map = L.map("map").setView([22.3072, 73.1812], 13);
let markers = [];
let selectedLocationMarker = null;
let baseLat = null;
let baseLon = null;
let debounceTimer;
let selectedIndex = -1;
let routingControl = null; // New variable to store the route

const fuelIcon = L.divIcon({
    html: "<div class='custom-marker'>⛽</div>",
    className: "fuel-emoji-icon",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

const input = document.getElementById("locationInput");
const suggestionBox = document.getElementById("suggestions");

document.getElementById("searchBtn").addEventListener("click", searchLocation);
document.getElementById("locBtn").addEventListener("click", useMyLocation);

input.addEventListener("input", handleAutocomplete);
input.addEventListener("keydown", handleKeyNavigation);

map.on("click", function(e) {
    setLocation(e.latlng.lat, e.latlng.lng);
});

function setLocation(lat, lon) {
    baseLat = parseFloat(lat);
    baseLon = parseFloat(lon);

    if (selectedLocationMarker) map.removeLayer(selectedLocationMarker);

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
            if (data.length > 0) {
                setLocation(data[0].lat, data[0].lon);
            } else {
                alert("Location not found. Please try a different search term.");
            }
        })
        .catch(err => console.error("Search error:", err));
}

function useMyLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser");
        return;
    }
    
    const locBtn = document.getElementById("locBtn");
    const originalText = locBtn.textContent;
    locBtn.textContent = "Locating...";

    navigator.geolocation.getCurrentPosition(
        pos => {
            locBtn.textContent = originalText;
            setLocation(pos.coords.latitude, pos.coords.longitude);
        },
        err => {
            locBtn.textContent = originalText;
            alert("Unable to retrieve your location. Please check your permissions.");
        }
    );
}

function findPetrolPumps(lat, lon) {
    clearMapData(); // Clears markers AND existing routes
    
    const list = document.getElementById("pumpList");
    const count = document.getElementById("resultCount");
    const loading = document.getElementById("loading");
    const emptyState = document.getElementById("emptyState");

    list.innerHTML = "";
    count.textContent = "(0)";
    emptyState.classList.add("hidden");
    loading.classList.remove("hidden");

    // Radius changed to 3000m (3km)
    const query = `
    [out:json];
    (
      node["amenity"="fuel"](around:3000,${lat},${lon});
      way["amenity"="fuel"](around:3000,${lat},${lon});
      relation["amenity"="fuel"](around:3000,${lat},${lon});
    );
    out center;
    `;

    fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query
    })
    .then(res => res.json())
    .then(data => {
        loading.classList.add("hidden");

        if (!data.elements || data.elements.length === 0) {
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

        // Remove duplicates and sort by distance
        pumps = pumps.filter((v,i,a)=>a.findIndex(v2=>(v2.lat===v.lat && v2.lon===v.lon))===i);
        pumps.sort((a, b) => a.distance - b.distance);

        // Keep ONLY the top 5 closest pumps
        pumps = pumps.slice(0, 5);

        count.textContent = `(${pumps.length})`;

        pumps.forEach(pump => {
            const distanceText = pump.distance.toFixed(2) + " km away";

            const marker = L.marker([pump.lat, pump.lon], { icon: fuelIcon }).addTo(map);
            marker.bindPopup(`<b>${pump.name}</b><br>${distanceText}<br><small>Click to route</small>`);
            markers.push(marker);

            // Draw route if marker is clicked
            marker.on('click', () => {
                drawRoute(pump.lat, pump.lon);
            });

            const li = document.createElement("li");
            li.innerHTML = `
                <div class="pump-info">
                    <strong>${pump.name}</strong>
                    <span class="distance">${distanceText}</span>
                </div>
                <div class="go-icon">➔</div>
            `;
            
            // Draw route and center map when list item is clicked
            li.onclick = () => {
                drawRoute(pump.lat, pump.lon);
                marker.openPopup();
            };

            list.appendChild(li);
        });
    })
    .catch(err => {
        console.error("Overpass API error:", err);
        loading.classList.add("hidden");
        emptyState.textContent = "Error fetching data. Please try again later.";
        emptyState.classList.remove("hidden");
    });
}

// Function to draw the driving route
function drawRoute(destLat, destLon) {
    // Remove old route if it exists
    if (routingControl) {
        map.removeControl(routingControl);
    }

    // Create a new route
    routingControl = L.Routing.control({
        waypoints: [
            L.latLng(baseLat, baseLon),
            L.latLng(destLat, destLon)
        ],
        routeWhileDragging: false,
        addWaypoints: false, // Prevents users from adding intermediate points by dragging the line
        show: false, // Hides the default text itinerary box which can clutter the UI
        lineOptions: {
            styles: [{color: '#0984e3', opacity: 0.8, weight: 6}]
        },
        createMarker: function() { return null; } // Prevents adding default green/red markers over our existing ones
    }).addTo(map);

    // Zoom out slightly to fit the whole route in view
    map.fitBounds([
        [baseLat, baseLon],
        [destLat, destLon]
    ], { padding: [50, 50] });
}

// Updated to clear both markers AND routes when searching a new area
function clearMapData() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
