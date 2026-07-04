const API_KEY = "78280daf-f373-4cb8-98c9-174aa8473fff";

async function loadMatches() {
  const url = `https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=0`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const container = document.getElementById("matches");
    container.innerHTML = "";

    data.data.forEach(match => {
      container.innerHTML += `
        <div class="match-card">
          <h3>${match.name}</h3>
          <p><b>Status:</b> ${match.status}</p>
          <p><b>Venue:</b> ${match.venue}</p>
          <hr>
        </div>
      `;
    });

  } catch (error) {
    console.log(error);
  }
}

loadMatches();