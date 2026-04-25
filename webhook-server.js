const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");

const PORT = 9000;
const SECRET = "change-this-to-a-long-secret";

function verifySignature(req, body) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", SECRET);
  const digest = "sha256=" + hmac.update(body).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/github-webhook") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const chunks = [];

  req.on("data", (chunk) => chunks.push(chunk));

  req.on("end", () => {
    const body = Buffer.concat(chunks);

    if (!verifySignature(req, body)) {
      res.writeHead(401);
      res.end("Invalid signature");
      return;
    }

    res.writeHead(200);
    res.end("Deploy started");

    exec("cd ~/srb-event-hub && ./do-pull.sh", (error, stdout, stderr) => {
      console.log(stdout);
      console.error(stderr);

      if (error) {
        console.error("Deploy failed:", error.message);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
