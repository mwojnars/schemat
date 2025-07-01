###################################################
#
# INSTALL

# download most recent binary distribution from: https://kafka.apache.org/downloads
cd ~/Apps
wget https://downloads.apache.org/kafka/3.3.1/kafka_2.13-3.3.1.tgz
tar -xzf kafka_2.13-3.3.1.tgz
rm kafka_2.13-3.3.1.tgz

# place Kafka binaries and data inside /opt with a symlink from ~/kafka
sudo mv ~/Apps/kafka_2.13-3.3.1/ /opt/
sudo ln -s /opt/kafka_2.13-3.3.1/ /opt/kafka
sudo ln -s /opt/kafka ~/kafka
mkdir /opt/kafka/data
mkdir /opt/kafka/data/catalog-demo

# tools
sudo apt install kafkacat


###################################################
#
# INIT

# copy the server.properties file from /opt/kafka/config/kraft/server.properties (note the *KRAFT* subfolder!) ... make changes in the file as needed...
cp /opt/kafka/config/kraft/server.properties ~/.../demo/kafka/

# create a cluster ID & initialize data folder; the cluster ID is copied to the data folder, so the server (below) only
# needs to know the folder path, and it reads the cluster ID from the folder
cd ~/.../demo/kafka
/opt/kafka/bin/kafka-storage.sh random-uuid > cluster.id
/opt/kafka/bin/kafka-storage.sh format -t `cat cluster.id` -c server.properties


###################################################
#
# RUN

cd ~/.../demo/kafka
/opt/kafka/bin/kafka-server-start.sh server.properties

# create a topic
/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --topic test-topic
/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic test-topic
/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

# produce & consume
/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic test-topic
/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic test-topic --from-beginning


###################################################
#
# NODE.JS

# Kafka Node.js packages:
# * https://github.com/tulios/kafkajs         - reimplementation of librdkafka in native Javascript, 3k stars 300k installs (growing)
# - https://github.com/Blizzard/node-rdkafka  - binding to a C/C++ library, super-fast, 1.9k stars 25k installs
# - https://github.com/SOHU-Co/kafka-node     - plain Javascript, 2.6k stars 240k installs (decreasing), last git change 3 years ago!
# - https://github.com/nodefluent/node-sinek  - based on node-rdkafka & kafka-node, possibly provides higher-level functionality (??), 290 starts
# Comparison on NPM:
# - https://npmtrends.com/kafka-node-vs-kafkajs-vs-node-rdkafka

# Kafka tooling:
# - https://github.com/edenhill/kcat (kcat)