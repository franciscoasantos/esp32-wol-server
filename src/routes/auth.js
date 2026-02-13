const { generateToken } = require('../auth/jwt');
const { loginPage } = require('../views');
const { LOGIN_USER, LOGIN_PASS } = require('../config');

function handleLogin(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
  res.end(loginPage);
}

function handleLogout(req, res) {
  res.writeHead(302, {
    "Set-Cookie": "token=; HttpOnly; Path=/; Max-Age=0",
    "Location": "/login"
  });
  res.end();
}

function handleAuth(req, res) {
  let body = "";
  req.on("data", chunk => body += chunk);

  req.on("end", () => {
    const params = new URLSearchParams(body);
    const user = params.get("user");
    const pass = params.get("pass");

    if (user === LOGIN_USER && pass === LOGIN_PASS) {
      const token = generateToken(user);
      res.writeHead(302, {
        "Set-Cookie": `token=${token}; HttpOnly; Path=/`,
        "Location": "/"
      });
      return res.end();
    }

    res.writeHead(401);
    res.end("Invalid login");
  });
}

module.exports = {
  handleLogin,
  handleLogout,
  handleAuth
};
