const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Is Running At http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (authHeader === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "secretToken", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
}

// API - 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `SELECT *
                        FROM user 
                        WHERE username LIKE '${username}';`;
  const dbUser = await database.get(getUserQuery);

  switch (true) {
    case dbUser !== undefined:
      response.status(400);
      response.send("User already exists");
      break;
    case password.length < 6:
      response.status(400);
      response.send("Password is too short");
      break;
    default:
      const postUserQuery = `
              INSERT INTO user(username, password, name, gender)
              VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await database.run(postUserQuery);
      response.send("User created successfully");
  }
});

// API - 2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "secretToken");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API - 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
  const loggedInUserId = await database.get(loggedInUserIdQuery);

  const userTweetQuery = `SELECT username,
                                    tweet,
                                    date_time AS dateTime
                            FROM user 
                                INNER JOIN  tweet 
                                    ON tweet.user_id = user.user_id
                            WHERE tweet.user_id IN (
                                SELECT following_user_id
                                FROM follower
                                WHERE follower_user_id = ${loggedInUserId.user_id})
                            ORDER BY dateTime DESC
                            LIMIT 4;`;
  const resultTweets = await database.all(userTweetQuery);
  response.send(resultTweets);
});

// API - 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
  const loggedInUserId = await database.get(loggedInUserIdQuery);

  const userFollowingQuery = `SELECT name
                                 FROM user 
                                WHERE user_id IN (
                                    SELECT following_user_id
                                    FROM follower
                                    WHERE follower_user_id = ${loggedInUserId.user_id}
                                );`;
  const userFollowingResult = await database.all(userFollowingQuery);
  response.send(userFollowingResult);
});

// API - 5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
  const loggedInUserId = await database.get(loggedInUserIdQuery);

  const userFollowersQuery = `SELECT name
                                 FROM user 
                                 WHERE user_id IN (
                                     SELECT follower_user_Id
                                     FROM follower
                                     WHERE following_user_id = ${loggedInUserId.user_id}
                                 );`;
  const userFollowersResult = await database.all(userFollowersQuery);
  response.send(userFollowersResult);
});

// API - 6

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
  const loggedInUserId = await database.get(loggedInUserIdQuery);

  const { tweetId } = request.params;

  const getTweetQuery = `SELECT *
                        FROM tweet
                        WHERE tweet_id = ${tweetId};`;
  const tweetResult = await database.get(getTweetQuery);

  const likeTweetQuery = `SELECT COUNT(like_id) AS likes
                             FROM like
                             WHERE tweet_id = ${tweetId};`;
  const likeTweetResult = await database.get(likeTweetQuery);

  const getReplyQuery = `SELECT COUNT(reply_id) AS replies
                            FROM reply
                            WHERE tweet_id = ${tweetId};`;
  const replyResult = await database.get(getReplyQuery);

  const userFollowingQuery = `SELECT *
                                 FROM tweet
                                 WHERE tweet_id = ${tweetId} AND 
                                 tweet.user_id IN (
                                     SELECT following_user_id
                                     FROM follower
                                     WHERE follower_user_id = ${loggedInUserId.user_id});`;
  const userFollowingResult = await database.all(userFollowingQuery);

  if (userFollowingResult.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send({
      tweet: tweetResult.tweet,
      likes: likeTweetResult.likes,
      replies: replyResult.replies,
      dateTime: tweetResult.date_time,
    });
  }
});

// API - 7
app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
    const loggedInUserId = await database.get(loggedInUserIdQuery);

    const userFollowingQuery = `SELECT *
                                 FROM tweet
                                 WHERE tweet_id = ${tweetId} AND 
                                 tweet.user_id IN (
                                     SELECT following_user_id
                                     FROM follower
                                     WHERE follower_user_id = ${loggedInUserId.user_id});`;
    const userFollowingResult = await database.all(userFollowingQuery);

    const getLikesQuery = `SELECT username
                              FROM like
                                    INNER JOIN user ON user.user_id = like.user_id
                              WHERE tweet_id = ${tweetId};`;
    const likesResult = await database.all(getLikesQuery);

    const usersLikedArray = [];
    likesResult.map((eachUserName) =>
      usersLikedArray.push(eachUserName.username)
    );

    if (userFollowingResult.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({
        likes: usersLikedArray,
      });
    }
  }
);

//API - 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
    const loggedInUserId = await database.get(loggedInUserIdQuery);

    const userFollowingQuery = `SELECT *
                                 FROM tweet
                                 WHERE tweet_id = ${tweetId} AND 
                                 tweet.user_id IN (
                                     SELECT following_user_id
                                     FROM follower
                                     WHERE follower_user_id = ${loggedInUserId.user_id});`;
    const userFollowingResult = await database.all(userFollowingQuery);

    const getRepliesQuery = `SELECT name,
                                       reply
                                FROM user
                                    INNER JOIN reply ON user.user_id = reply.user_id
                                WHERE tweet_id = ${tweetId};`;
    const repliesResult = await database.all(getRepliesQuery);

    const userRepliesArray = [];

    if (userFollowingResult.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({
        replies: repliesResult,
      });
    }
  }
);

//API - 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
  const loggedInUserId = await database.get(loggedInUserIdQuery);

  const getTweetQuery = `SELECT tweet,
                                   (SELECT COUNT(like_id)
                                    FROM like
                                    WHERE like.tweet_id = tweet.tweet_id) AS likes,
                                    (SELECT COUNT(reply_id)
                                    FROM reply
                                    WHERE reply.tweet_id = tweet.tweet_id) AS replies,
                                    (SELECT date_time
                                     FROM tweet) AS dateTime
                           FROM tweet
                           WHERE tweet.user_id = ${loggedInUserId.user_id};`;
  const tweetResult = await database.all(getTweetQuery);

  response.send(tweetResult);
});

// API - 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
  const loggedInUserId = await database.get(loggedInUserIdQuery);

  const postTweetQuery = `INSERT INTO tweet(tweet, user_id)
                            VALUES ('${tweet}', ${loggedInUserId.user_id});`;
  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

// API - 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const loggedInUserIdQuery = `SELECT user_id FROM user WHERE username LIKE '${username}';`;
    const loggedInUserId = await database.get(loggedInUserIdQuery);

    const tweetUserIdQuery = `SELECT user_id
                                FROM tweet
                                WHERE tweet_id = ${tweetId};`;
    const tweetUserId = await database.get(tweetUserIdQuery);

    if (loggedInUserId.user_id == tweetUserId.user_id) {
      const deleteTweetQuery = `DELETE FROM tweet
                                    WHERE tweet_id = ${tweetId};`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
