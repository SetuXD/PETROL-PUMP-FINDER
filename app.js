let map = L.map("map").setView([23.0225, 72.5714], 13); //Within Guj
let markers = [];
let baseLat, baseLon;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

function searchLocation() {
    const place = document.getElementById("locationInput").value;
    if (!place) return;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${place}`)
        .then(res => res.json())
        .then(data => {
            if (data.length > 0) {
                baseLat = data[0].lat;
                baseLon = data[0].lon;
                map.setView([baseLat, baseLon], 14);
                findPetrolPumps(baseLat, baseLon);
            }
        });
}

function useMyLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
        baseLat = pos.coords.latitude;
        baseLon = pos.coords.longitude;
        map.setView([baseLat, baseLon], 14);
        findPetrolPumps(baseLat, baseLon);
    });
}

function findPetrolPumps(lat, lon) {
    clearAll();

    const query = `
    [out:json];
    node[amenity=fuel](around:2000,${lat},${lon});
    out;
    `;

    fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query
    })
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById("pumpList");
        list.innerHTML = "";

        data.elements.forEach(pump => {
            const distance = getDistance(lat, lon, pump.lat, pump.lon).toFixed(2);

            const marker = L.marker([pump.lat, pump.lon]).addTo(map)
                .bindPopup(
                    `<b>${pump.tags.name || "Petrol Pump"}</b><br>
                     ${distance} km away`
                );

            markers.push(marker);

            const li = document.createElement("li");
            li.innerHTML = `<b>${pump.tags.name || "Petrol Pump"}</b><br>${distance} km away`;
            li.onclick = () => {
                map.setView([pump.lat, pump.lon], 17);
                marker.openPopup();
            };
            list.appendChild(li);
        });
    });
}

function clearAll() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}


