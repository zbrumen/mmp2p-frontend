import 'babel-polyfill'
import Libp2p from 'libp2p'
import Websockets from 'libp2p-websockets'
import WebRTCStar from 'libp2p-webrtc-star'
import { NOISE } from '@chainsafe/libp2p-noise'
import Mplex from 'libp2p-mplex'
import Bootstrap from 'libp2p-bootstrap'
import { _ } from 'core-js'
import 'bson'
import BSON from 'bson'
//import pipe from 'it-pipe'
//import lp from 'it-length-prefixed'

const snapId = `local:http://localhost:8080`;

const ethereum = window.ethereum;
const userInformation = {};
let libp2p;

class ChatConnection {

  // answer constructor
  constructor(connection, peerId, isDial) {
    this.peerId = peerId;
    this.connection = connection;
    this.stream = connection.stream;
    console.log(connection);


    // starts recieving data from connection stream.
    if(isDial) {
      this.sendData(userInformation);
      this._dialCallback();
    } else {
      // answer with basic information
      // this.sendData(userInformation);
      this._answerCallback();
    }
  }

  async sendData(data) {
    if(data === undefined || data === null) { data = {} }
    data.status = "ok"
    try {
      let ar = BSON.serialize(data);
      console.log("sending data", ar);
      console.log(await this.stream.sink(ar));
      console.log("sent data");
    } catch(err) {
      console.log("Error sending data", err);
      //this.stream.close();
    }
  }

  async _dialCallback() {
    let data = {};
    let fullyEstablished = false;
    console.log("started listening", this.stream);
    for await (const msg of this.stream.source) {
      console.log("recieved something", msg);
      try {
        data = BSON.deserialize(msg);
      } catch(err) {
        console.log(err);
      }
      console.log("recieved", data);
      if(data.status === "ok") {
        if(this.username === undefined) {
          if(data.username === undefined) {
            console.log("Expected initial message, recieved weird response", data);
            // stop the connection, and return
            //this.close("nok", "weird response");
            return;
          } else {
            this.username = data.username;
            this.walletId = data.walletId;
            // check with our user, if he wants to establish a chat window with this user.
            if(!await ethereum.request({
              method: 'wallet_invokeSnap',
              params: [snapId, {
                method: 'dial',
                params: {
                  user: userInformation.username,
                  otherUser: this.username,
                  otherUserPeerId: this.peerId,
                  otherUserWalletId: this.walletId,
                }
              }]
            })) {
              // our user does not agree with this connection, close chat now.
              //this.close("nok", "unauthorized");
              return;
            } else {
              // fully initialize connection
              this.createDOM("Waiting for response");
              // confirm to the connection, that everything is  authorized.
              await this.sendData(userInformation);
            }
          }
        } else if (!fullyEstablished){
          this.chatbox.append("User " + this.username + "has connected!")
          fullyEstablished = true;
        } else {
          this.chatbox.append(`<${this.username}>: ${data.message}\n`);
        }
      } else {
        // something went wrong
        console.error("status not ok", data);
        //this.close("nok", "status: " + data.status);
      }
    }
    console.log("done listening");
  }

  async _answerCallback() {
    let data = {};
    console.log("started listening", this.stream);
    for await (const msg of this.stream.source) {
      console.log("recieved something");
      try {
        data = BSON.deserialize(msg);
      } catch(err) {
        console.error(err);
      }
      if(data.status === "ok") {
        if(this.username === undefined) {
          if(data.username === undefined) {
            console.log("Expected initial message, recieved weird response", data);
            // stop the connection, and return
            //this.close("nok", "weird response");
            return;
          } else {
            this.username = data.username;
            this.walletId = data.walletId;
            // check with our user, if he wants to establish a chat window with this user.
            if(!await ethereum.request({
              method: 'wallet_invokeSnap',
              params: [snapId, {
                method: 'answer',
                params: {
                  user: userInformation.username,
                  otherUser: this.username,
                  otherUserPeerId: this.peerId,
                  message: data.message,
                }
              }]
            })) {
              // our user does not agree with this connection, close chat now.
              //this.close("nok", "unauthorized");
              return;
            } else {
              // fully initialize connection
              this.createDOM("User " + this.username + "has connected!");
              // confirm to the connection, that everything is  authorized.
              await this.sendData();
            }
          }
        }
      } else {
        // something went wrong
        console.error("status not ok", data);
        this.close("nok", "status: " + data.status);
      }
    }
    console.log("done listening");
  }

  close(status, reason) {
    console.log("closing", status, reason);
    if(this.chatbox !== undefined) {
      this.chatbox.append("Closed connection, reason: " + reason.toString());
    }
    // stop myself from being dumb...
    if(status === "ok") { status = "close" }
    this.sendData({ status, reason });
    this.stream.close();
  }

  createDOM(message) {
    let display = 
`
<div id="${this.peerId}">
  <textarea class="chatbox" disabled style="width: 90%; height: 100px;">${message}</textarea>
  <hr>
  <input type="text" style="width: 90%;" class="chatInput"> <button class="sendChat">Send</button> <button class="close">Close connection</button>
</div><hr>`
    document.getElementById("chats").append(display);

    this.chatbox = document.querySelector("#" + this.peerId +  ".chatbox");
    this.chatinput = document.querySelector("#" + this.peerId +  ".chatInput");
    document.querySelector("#" + this.peerId +  ".chatSend").addEventListener('click', async function() {
      // send message to our friend :)
      await this.sendData({message: this.chatinput.value});
      this.chatbox.append(`<me>: ${this.chatinput.value} \n`);
      this.chatinput.value = "";
    });
    document.querySelector("#" + this.peerId +  ".close").addEventListener('click', async function() {
      // close this connection, say goodbye first :(
      //this.close("close", "User closed connection")  
    });
  }
  
}

const connections = {};
const addresses = {};

document.addEventListener('DOMContentLoaded', async () => {

  document.getElementById("connectMetaMask").addEventListener('click', async () => {
    try {
      if(libp2p === undefined) {
        // Create our libp2p node
        libp2p = await Libp2p.create({
          addresses: {
            // Add the signaling server address, along with our PeerId to our multiaddrs list
            // libp2p will automatically attempt to dial to the signaling server so that it can
            // receive inbound connections from other peers
            listen: [
              '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star',
              '/dns4/wrtc-star2.sjc.dwebops.pub/tcp/443/wss/p2p-webrtc-star'
            ]
          },
          modules: {
            transport: [Websockets, WebRTCStar],
            connEncryption: [NOISE],
            streamMuxer: [Mplex],
            peerDiscovery: [Bootstrap]
          },
          config: {
            peerDiscovery: {
              // The `tag` property will be searched when creating the instance of your Peer Discovery service.
              // The associated object, will be passed to the service when it is instantiated.
              [Bootstrap.tag]: {
                enabled: true,
                list: [
                  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
                  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
                  '/dnsaddr/bootstrap.libp2p.io/p2p/QmZa1sAxajnQjVM8WjWXoMbmPd7NsWhfKsPkErzpm9wGkp',
                  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
                  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
                ]
              }
            }
          }
        })
        // Listen for new peers
        libp2p.on('peer:discovery', (peerId) => {
          //console.log(`Found peer ${peerId.toB58String()}`)
        })

        // Listen for new connections to peers
        libp2p.connectionManager.on('peer:connect', (connection) => {
         // console.log(`Connected to ${connection.remotePeer.toB58String()}`)
         addresses[connection.remotePeer.toB58String()] = connection.remoteAddr;
         //console.log("adding", connection.remoteAddr.toString());
        })

        // Listen for peers disconnecting
        libp2p.connectionManager.on('peer:disconnect', (connection) => {
         // console.log(`Disconnected from ${connection.remotePeer.toB58String()}`)
         addresses[connection.remotePeer.toB58String()] = undefined;
        })



        await libp2p.start()
        console.log(`libp2p id is ${libp2p.peerId.toB58String()}`)
        userInformation.peerId = libp2p.peerId.toB58String();
        
        // We listen to any new connection made to us for p2p chat.
        libp2p.handle("/chat/mmp2p/1.0.0", async (connection) => {
          // pipe data from the connection
          connections[connection.connection.remotePeer.toB58String()] = new ChatConnection(connection, connection.connection.remotePeer.toB58String(), false);
        })


        try {
          await ethereum.request({
            method: 'wallet_enable',
            params: [{
              wallet_snap: { [snapId]: {} },
            }]
          });
        } catch(err) {
          console.log("ERROR", err)
        }
      }
      
      let accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      userInformation.walletId = accounts[0];
      userInformation.username = document.getElementById("username").value;

      if(!await ethereum.request({
        method: 'wallet_invokeSnap',
        params: [snapId, {
          method: 'connect',
          params: userInformation
        }]
      })) {
        libp2p.stop();
        libp2p = undefined;
      }
    } catch (err) {
      console.error(err);
    }

    
  })
  document.getElementById("connect").addEventListener('click', async function() {
    dialPeerId = document.getElementById("otherPeerId").value;
    dialWalletId = document.getElementById("otherWalletId").value;
    // kind of ugly, but it works ... :/
    for (ma in libp2p.multiaddrs) {
      let connectMa = libp2p.multiaddrs[ma] + "/p2p/" + dialPeerId;
      console.log("trying", connectMa);
      try {
        const connection = await libp2p.dialProtocol(connectMa, "/chat/mmp2p/1.0.0");
        connections[dialPeerId] = new ChatConnection(connection, dialPeerId, true);
        return
      } catch(err) {
        console.log("didn't find", connectMa, "trying next...", err);
      }
    }
  })
})
