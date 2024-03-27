import bodyParser from "body-parser";
import express from "express";
import {BASE_NODE_PORT} from "../config";
import {Value, NodeState} from "../types";
import {delay} from "../utils";
import * as console from "console";

export async function node(
    nodeId: number,
    N: number,
    F: number,
    initialValue: Value,
    isFaulty: boolean,
    nodesAreReady: () => boolean,
    setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let currentNodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null,
  }
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Route pour vérifier l'état d'un nœud
  node.get("/status", (req, res) => {
    const status = isFaulty ? "faulty" : "live";
    const statusCode = isFaulty ? 500 : 200;
    res.status(statusCode).send(status);
  });

  // Route pour obtenir l'état actuel d'un nœud
  node.get("/getState", (req, res) => {
    const { killed, x, decided, k } = currentNodeState;
    res.status(200).send({ killed, x, decided, k });
  });

  node.get("/stop", (req, res) => {
    if (!currentNodeState.killed) {
      currentNodeState.killed = true;
      res.status(200).send("killed");
    } else {
      res.status(200).send("already killed");
    }
  });

// Route pour recevoir les messages
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body; // Utilisation de 'let' pour 'x' pour permettre la réaffectation

    if (!isFaulty && !currentNodeState.killed) {

      if (messageType === "propose") {
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }

        let proposal = proposals.get(k);
        if (proposal) {
          proposal.push(x);

          if (proposal.length >= (N - F)) {
            const count0 = proposal.filter(el => el === 0).length;
            const count1 = proposal.filter(el => el === 1).length;

            if (count0 > (N / 2)) x = 0;
            else if (count1 > (N / 2)) x = 1;
            else x = "?";

            // Envoie de la prop aux noeuds
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ k, x, messageType: "vote" }),
              });
            }
          }
        }
      }
      // Traitement pour le type de message "vote"
      else if (messageType === "vote") {
        // Ici on init le tableau de vote
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        let vote = votes.get(k);
        if (vote) {
          vote.push(x);

          // On checdk si le nbre de votes à atteint le seuil
          if (vote.length >= (N - F)) {
            console.log("vote", vote, "node :", nodeId, "k :", k);

            // Ici o ncompte le nombre de vote
            const count0 = vote.filter(el => el === 0).length;
            const count1 = vote.filter(el => el === 1).length;

            // On détermine le nouvel état du noeud
            if (count0 >= F + 1) {
              currentNodeState.x = 0;
              currentNodeState.decided = true;
            } else if (count1 >= F + 1) {
              currentNodeState.x = 1;
              currentNodeState.decided = true;
            } else {
              if (count0 + count1 > 0 && count0 > count1) {
                currentNodeState.x = 0;
              } else if (count0 + count1 > 0 && count0 < count1) {
                currentNodeState.x = 1;
              } else {
                currentNodeState.x = Math.random() > 0.5 ? 0 : 1;
              }
              currentNodeState.k = k + 1;

              // Nouvelle prop aux autres noeuds
              for (let i = 0; i < N; i++) {
                fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" }),
                });
              }
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  // Route pour démarrer l'algorithme de consensus
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5);
    }
    if (!isFaulty) {
      currentNodeState.k = 1;
      currentNodeState.x = initialValue;
      currentNodeState.decided = false;
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" }),
        });
      }
    }
    else {
      currentNodeState.decided = null;
      currentNodeState.x = null;
      currentNodeState.k = null;
    }
    res.status(200).send("Consensus algorithm started.");
  });

  // On launch le serveur
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
        `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // le noeud est prêt
    setNodeIsReady(nodeId);
  });

  return server;
}