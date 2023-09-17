const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const readline = require('readline');
const fetch = require("node-fetch");
const color = require("colors")
const WebSocketClient = require("websocket").client;

// Custom console.log that sends data to the server
function customLog(message) {
  console.log(message); // Send message to nodejs console

  // Remove lines starting with ">...."
  const formattedMessage = message.replace(/^>+\.\.\.\..*/gm, '');

  // Remove ANSI escape sequences
  const cleanMessage = formattedMessage.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

  // Send formatted message to client
  if (cleanMessage.includes('WARN')) {
    io.emit('consoleLog', `<p class="text-amber-500 font-bold">⚠️ ` + cleanMessage + `</p>`);
    return
  } else if (cleanMessage.includes('container@pterodactyl~')) {
    io.emit('consoleLog', `<span>` + cleanMessage.replace('container@pterodactyl~', "<span class='text-sky-400 font-bold'>container@pterodactyl ~ </span>") + `</span>`);
    return
  } else if (cleanMessage.includes('Server marked as')) {
    io.emit('consoleLog', `<p class="text-amber-500 font-bold">` + cleanMessage + `</p>`)
  } else {
    // Send message without special formatting
    io.emit('consoleLog', `<p>` + cleanMessage + `</p>`);
    return
  }
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(__dirname + '/index.html');
});

// Pterodactyl config
const config = {
    "panelUrl": "https://***",
    "pterodactylUserApiKey": "***",
    "serverUUID": "***"
};

// ReadLine for the commands
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

// Tramsmit between nodejs console and express
let recieveCommand;
io.on('connection', (socket) => {
  customLog('🟢 <span class="font-bold text-emerald-400">A user connected<span>');  
  socket.on('disconnect', () => {
    console.log('🔴 User disconnected');
  });
});

http.listen(3000, () => {
  console.log('Express is running on http://localhost:3000');
});

// Init 
const prod = () => {

    //Fetch Token and socket URL
    fetch(`${config.panelUrl}/api/client/servers/${config.serverUUID}/websocket`, {
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.pterodactylUserApiKey}`
        }
    }).then(res => res.json()).then(body => {
    
        const token = body.data.token;
        const socket = body.data.socket;
        const client = new WebSocketClient();
    
        client.on("connectFailed", function(error) {
            console.log("Connect Error: " + error.toString());
        });
    
        client.on("connect", async function(connection) {

            // Send Token auth on connection
            await connection.sendUTF(`{"event":"auth","args":["${token}"]}`)

            // request logs after 1 second
            setTimeout(() => { connection.sendUTF(`{"event":"send logs","args":[null]}`) }, 1000)
            
            connection.on("error", function(error) {
                console.log("Connection Error: " + error.toString());
            });
    
            // receiving messages
            connection.on("message", function(message) {

                // return != UTF-8
                if (message.type != "utf8") return;

                if (message.utf8Data.startsWith(`{"event":"auth success"}`)) {
                  customLog('<p class="font-bold">🔑 Auth success</p>');
                  return
                }
                
                // Return stats (memory usage, ...)
                if (message.utf8Data.startsWith(`{"event":"stats"`)) return;
                
                // Logs Install output
                if (message.utf8Data.startsWith(`{"event":"install output"`)) return customLog(color.blue(`[Daemon]: ${JSON.parse(message.utf8Data).args.toString()}`))
                
                // Logs console output
                if (message.utf8Data.startsWith(`{"event":"console output"`)) return customLog(JSON.parse(message.utf8Data).args.toString())
                
                // On token expiring, close connection and restart program
                if (message.utf8Data.startsWith(`{"event":"token expiring"`)) { connection.close(); prod(); return;}
                
                // Logs status message (starting, start, stoping, stop, ...)
                if (message.utf8Data.startsWith(`{"event":"status"`)) return customLog(color.yellow(`Server marked as ${JSON.parse(message.utf8Data).args.toString()}`))
                customLog(color.red(message))
            });
    
            // On command on console
            rl.on('line', function(line){

                // If command "close", close connection and exit program but NOT close the server
                if (line === 'close') { connection.close(); process.exit(0); }
                
                // if command "power", change the power according to the argument (power kill = kill the server, power start = start the server, ...) 
                if (line.startsWith('power')) return connection.sendUTF(`{"event":"set state","args":["${line.split(/ +/)[1]}"]}`)
                connection.sendUTF(`{"event":"send command","args":["${line}"]}`)
            })

              io.on('connection', (socket) => {
                socket.on('command', (command) => {
                  recieveCommand = command.trim();
                  customLog('<span class="text-sky-400 font-bold"">~ </span>' + recieveCommand);
                  
                  connection.sendUTF(`{"event":"send command","args":["${recieveCommand}"]}`)
                });
              });
          
        });

        //Connect to socket URL
        client.connect(`${socket}`);
    })
}

// First start
prod()
